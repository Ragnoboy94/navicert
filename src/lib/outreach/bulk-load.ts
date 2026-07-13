import { classifyEmail } from "./email-filter";
import { enrichApplicantsFromCards } from "./enrich-applicants";
import { fetchDeclaration, normalizeDeclaration, searchExpiringDeclarations, declarationApplicantUrl } from "./fsa";
import {
  ensureFsaSession,
} from "./fsa-connection";
import { invalidateFsaBearerToken } from "./bearer";
import {
  cursorFromQueue,
  cursorNeedsRotation,
  describeFsaCursor,
  getSortField,
  healFsaPagination,
  isFsaPageLimitError,
  rotateFsaCursor,
  ruDateToIso,
  dateSlicesForLoad,
  upgradeLegacyPagination,
  type FsaLoadCursor,
} from "./fsa-pagination";
import { getExpiringMonthRange } from "./queue";
import { isEndDateInRange, pruneOutreachQueue } from "./queue-cleanup";
import type {
  FsaDeclaration,
  OutreachQueue,
  OutreachQueueItem,
} from "./types";

export { ruDateToIso };

const FSA_LIST_REQUEST_GAP_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFsaAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /401|403/.test(msg);
}

export type BulkLoadMode = "reset" | "append";

export type BulkLoadListOptions = {
  mode?: BulkLoadMode;
  maxItems?: number;
  pageSize?: number;
  range?: { from: string; to: string };
  existingQueue?: OutreachQueue | null;
};

export type BulkLoadListResult = {
  range: { from: string; to: string };
  nextApiPage: number;
  apiCursor: FsaLoadCursor;
  pageSize: number;
  hasMore: boolean;
  items: OutreachQueueItem[];
  rejected: OutreachQueueItem[];
  enrichQueue: FsaDeclaration[];
  loadedFromApi: number;
  addedNew: number;
  emailsFromList: number;
  cursorLabel: string;
  paginationVersion?: number;
};

export type EnrichBatchResult = {
  /** Карточки, окончательно убранные из очереди обогащения */
  processed: number;
  /** Карточки, возвращённые в хвост очереди (ещё без email) */
  requeued: number;
  emailsFound: number;
  enrichedFromCards: number;
  enrichPending: number;
  items: OutreachQueueItem[];
  rejected: OutreachQueueItem[];
  enrichQueue: FsaDeclaration[];
  problemDeclaration?: { id: number; url: string };
};

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ITEMS = 1000;

export function getEnrichBatchSize(): number {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_ENRICH_BATCH || 50), 10),
    100
  );
}

export function getCardEnrichPerBatch(): number {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_CARD_BATCH || 8), 1),
    20
  );
}

function parseAnyDate(value: string): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) {
    const [, day, month, year] = ru;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sortByEndDate<T extends { endDate: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = parseAnyDate(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseAnyDate(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });
}

function toQueueItem(declaration: FsaDeclaration): OutreachQueueItem {
  const normalized = normalizeDeclaration(declaration);
  const { status, reason } = classifyEmail(normalized.applicant?.email);
  return {
    ...normalized,
    emailStatus: status,
    emailRejectReason: reason,
  };
}

function mergeUnique(
  current: OutreachQueueItem[],
  incoming: OutreachQueueItem[]
): OutreachQueueItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function mergeEnrichQueue(
  current: FsaDeclaration[],
  incoming: FsaDeclaration[]
): FsaDeclaration[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (!normalizeDeclaration(item).applicant?.email?.trim()) {
      byId.set(item.id, normalizeDeclaration(item));
    }
  }
  return sortByEndDate([...byId.values()]);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function enrichEmailFromApi(
  declaration: FsaDeclaration
): Promise<FsaDeclaration> {
  const base = normalizeDeclaration(declaration);
  try {
    const detail = normalizeDeclaration(await fetchDeclaration(base.id));
    return normalizeDeclaration({
      ...base,
      ...detail,
      applicant: {
        ...base.applicant,
        ...detail.applicant,
        email: detail.applicant?.email?.trim() || base.applicant?.email,
        phone: detail.applicant?.phone?.trim() || base.applicant?.phone,
      },
    });
  } catch {
    return base;
  }
}

function collectKnownIds(queue: OutreachQueue | null): Set<number> {
  const ids = new Set<number>();
  if (!queue) return ids;
  for (const item of [...queue.items, ...queue.rejected, ...queue.enrichQueue]) {
    ids.add(item.id);
  }
  return ids;
}

/** Быстрая загрузка списка из API ФСА — без детального обогащения */
export async function bulkLoadList(
  options: BulkLoadListOptions = {}
): Promise<BulkLoadListResult> {
  const range = options.range ?? getExpiringMonthRange();
  const pageSize = Math.min(
    Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 10),
    100
  );
  const maxItems = Math.min(
    Math.max(options.maxItems ?? DEFAULT_MAX_ITEMS, 10),
    1000
  );
  const mode = options.mode ?? "reset";
  let existing = mode === "append" ? (options.existingQueue ?? null) : null;
  if (existing) {
    existing = healFsaPagination(existing).queue;
  }

  let paginationVersion =
    mode === "append" ? Math.max(existing?.paginationVersion ?? 1, 2) : 2;
  let dateSlices = dateSlicesForLoad(range, { mode, paginationVersion });
  let cursor =
    mode === "append"
      ? cursorFromQueue(existing)
      : { page: 0, sortIndex: 0, sliceIndex: 0 };
  const knownIds = collectKnownIds(existing);

  let sessionToken = (await ensureFsaSession()).token;

  const rawDeclarations: FsaDeclaration[] = [];
  let newIdsCollected = 0;
  let hasMore = true;
  let exhausted = false;
  let fetchAttempts = 0;
  let rotationSkips = 0;
  const maxFetchAttempts = Math.max(maxItems / pageSize + 12, 32);
  const maxRotationSkips = 16;

  while (newIdsCollected < maxItems && !exhausted && fetchAttempts < maxFetchAttempts) {
    fetchAttempts += 1;

    if (cursorNeedsRotation(cursor)) {
      const rotated = rotateFsaCursor(cursor, dateSlices.length);
      if (rotated.exhausted) {
        if (paginationVersion < 2 && mode === "append") {
          const upgraded = upgradeLegacyPagination(range);
          paginationVersion = upgraded.paginationVersion;
          dateSlices = upgraded.dateSlices;
          cursor = upgraded.cursor;
          exhausted = false;
          hasMore = true;
          continue;
        }
        exhausted = true;
        hasMore = false;
        break;
      }
      cursor = rotated.cursor;
    }

    const slice = dateSlices[cursor.sliceIndex] ?? dateSlices[0];
    const endDateFrom = ruDateToIso(slice.from);
    const endDateTo = ruDateToIso(slice.to);
    const sortField = getSortField(cursor);

    let batch: FsaDeclaration[];
    try {
      let authRetries = 0;
      while (true) {
        try {
          batch = await searchExpiringDeclarations(
            {
              endDateFrom,
              endDateTo,
              page: cursor.page,
              size: pageSize,
              sort: [sortField],
            },
            sessionToken
          );
          break;
        } catch (error) {
          if (authRetries < 1 && isFsaAuthError(error)) {
            invalidateFsaBearerToken();
            sessionToken = (
              await ensureFsaSession({ forceTokenRefresh: true })
            ).token;
            authRetries += 1;
            await sleep(500);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (isFsaPageLimitError(error)) {
        const rotated = rotateFsaCursor(cursor, dateSlices.length);
        if (rotated.exhausted) {
          if (paginationVersion < 2 && mode === "append") {
            const upgraded = upgradeLegacyPagination(range);
            paginationVersion = upgraded.paginationVersion;
            dateSlices = upgraded.dateSlices;
            cursor = upgraded.cursor;
            exhausted = false;
            hasMore = true;
            continue;
          }
          exhausted = true;
          hasMore = false;
          break;
        }
        cursor = rotated.cursor;
        continue;
      }
      throw error;
    }

    if (batch.length === 0) {
      const rotated = rotateFsaCursor(cursor, dateSlices.length);
      if (rotated.exhausted) {
        if (paginationVersion < 2 && mode === "append") {
          const upgraded = upgradeLegacyPagination(range);
          paginationVersion = upgraded.paginationVersion;
          dateSlices = upgraded.dateSlices;
          cursor = upgraded.cursor;
          exhausted = false;
          hasMore = true;
          continue;
        }
        exhausted = true;
        hasMore = false;
        break;
      }
      cursor = rotated.cursor;
      continue;
    }

    const fresh = batch.filter((item) => !knownIds.has(item.id));
    if (fresh.length === 0) {
      rotationSkips += 1;
      if (rotationSkips > maxRotationSkips) {
        hasMore = true;
        break;
      }
      const rotated = rotateFsaCursor(cursor, dateSlices.length);
      if (rotated.exhausted) {
        if (paginationVersion < 2 && mode === "append") {
          const upgraded = upgradeLegacyPagination(range);
          paginationVersion = upgraded.paginationVersion;
          dateSlices = upgraded.dateSlices;
          cursor = upgraded.cursor;
          exhausted = false;
          hasMore = true;
          continue;
        }
        exhausted = true;
        hasMore = false;
        break;
      }
      cursor = rotated.cursor;
      continue;
    }

    for (const item of batch) {
      knownIds.add(item.id);
    }
    rawDeclarations.push(...batch);
    newIdsCollected += fresh.length;
    rotationSkips = 0;
    cursor = { ...cursor, page: cursor.page + 1 };
    hasMore = !exhausted;

    if (batch.length < pageSize) {
      const rotated = rotateFsaCursor(cursor, dateSlices.length);
      if (rotated.exhausted) {
        if (paginationVersion < 2 && mode === "append") {
          const upgraded = upgradeLegacyPagination(range);
          paginationVersion = upgraded.paginationVersion;
          dateSlices = upgraded.dateSlices;
          cursor = upgraded.cursor;
          exhausted = false;
          hasMore = true;
          continue;
        }
        hasMore = false;
        break;
      }
      cursor = rotated.cursor;
    }

    if (newIdsCollected >= maxItems) {
      break;
    }

    await sleep(FSA_LIST_REQUEST_GAP_MS);
  }

  const addedNew = newIdsCollected;

  const inRange = sortByEndDate(
    rawDeclarations.map(normalizeDeclaration).filter((item) => isEndDateInRange(item, range))
  );

  const withEmail = inRange.filter((item) => item.applicant?.email?.trim());
  const needsEnrich = inRange.filter((item) => !item.applicant?.email?.trim());

  const classified = withEmail.map(toQueueItem);
  const eligible = classified.filter((item) => item.emailStatus === "eligible");
  const rejected = classified.filter((item) => item.emailStatus === "rejected");

  const baseItems = mode === "append" ? (existing?.items ?? []) : [];
  const baseRejected = mode === "append" ? (existing?.rejected ?? []) : [];
  const baseEnrichQueue =
    mode === "append" ? (existing?.enrichQueue ?? []) : [];

  const merged = pruneOutreachQueue(
    mergeUnique(baseItems, eligible),
    mergeUnique(baseRejected, rejected),
    range
  );

  return {
    range,
    nextApiPage: cursor.page,
    apiCursor: cursor,
    pageSize,
    hasMore,
    items: merged.items,
    rejected: merged.rejected,
    enrichQueue: mergeEnrichQueue(baseEnrichQueue, needsEnrich),
    loadedFromApi: rawDeclarations.length,
    addedNew,
    emailsFromList: withEmail.length,
    cursorLabel: describeFsaCursor(cursor, dateSlices),
    paginationVersion,
  };
}

/** Фоновое обогащение очереди: API-карточка + при необходимости Playwright */
export async function enrichQueueBatch(
  queue: OutreachQueue,
  batchSize = getEnrichBatchSize(),
  options?: { shouldAbort?: () => boolean }
): Promise<EnrichBatchResult> {
  const batch = queue.enrichQueue.slice(0, batchSize).map(normalizeDeclaration);
  if (batch.length === 0) {
    return {
      processed: 0,
      requeued: 0,
      emailsFound: 0,
      enrichedFromCards: 0,
      enrichPending: 0,
      items: queue.items,
      rejected: queue.rejected,
      enrichQueue: [],
    };
  }

  let problemDeclaration: { id: number; url: string } | undefined;

  const apiEnriched = await mapWithConcurrency(batch, 25, async (item) => {
    try {
      return await enrichEmailFromApi(item);
    } catch (error) {
      problemDeclaration = {
        id: item.id,
        url: item.registryUrl || declarationApplicantUrl(item.id),
      };
      return normalizeDeclaration(item);
    }
  });

  const withEmail = apiEnriched.filter((item) => item.applicant?.email?.trim());
  const stillMissing = apiEnriched.filter(
    (item) => !item.applicant?.email?.trim()
  );

  const cardBatch =
    options?.shouldAbort?.() === true
      ? []
      : stillMissing.slice(0, getCardEnrichPerBatch());
  let cardEnriched: FsaDeclaration[] = [];
  if (cardBatch.length > 0) {
    try {
      cardEnriched = await enrichApplicantsFromCards(cardBatch);
    } catch (error) {
      problemDeclaration = {
        id: cardBatch[0].id,
        url: cardBatch[0].registryUrl || declarationApplicantUrl(cardBatch[0].id),
      };
      console.error(
        "enrichApplicantsFromCards failed:",
        error instanceof Error ? error.message : error
      );
    }
  }
  const cardEnrichedIds = new Set(cardEnriched.map((item) => item.id));

  const resolved = [...withEmail, ...cardEnriched];
  const emailsFound = resolved.filter((item) =>
    item.applicant?.email?.trim()
  ).length;

  const classified = resolved.map(toQueueItem);
  const eligible = classified.filter((item) => item.emailStatus === "eligible");
  const rejected = classified.filter((item) => item.emailStatus === "rejected");

  const cardNoEmail = cardEnriched.filter(
    (item) => !item.applicant?.email?.trim()
  );
  const noEmailRejected = cardNoEmail.map((item) => toQueueItem(item));

  // Без email после Playwright — убираем из очереди (не крутить бесконечно).
  // Остальные без email — в хвост, чтобы дошла очередь до карточек 8–50 в батче.
  const stillNeedEnrich = stillMissing.filter(
    (item) => !cardEnrichedIds.has(item.id)
  );

  const remainingQueue = [
    ...queue.enrichQueue.slice(batch.length),
    ...stillNeedEnrich,
  ];

  const merged = pruneOutreachQueue(
    mergeUnique(queue.items, eligible),
    mergeUnique(mergeUnique(queue.rejected, rejected), noEmailRejected),
    queue.range
  );

  const enrichQueue = mergeEnrichQueue([], remainingQueue);
  const requeued = stillNeedEnrich.length;
  const processed = batch.length - requeued;

  return {
    processed,
    requeued,
    emailsFound,
    enrichedFromCards: cardEnriched.length,
    enrichPending: enrichQueue.length,
    items: merged.items,
    rejected: merged.rejected,
    enrichQueue,
    problemDeclaration,
  };
}

export function listResultToQueue(
  result: BulkLoadListResult,
  options?: { mode?: "reset" | "append"; existing?: OutreachQueue | null }
): OutreachQueue {
  const mode = options?.mode ?? "reset";
  const existing = options?.existing;
  const enrichPending = result.enrichQueue.length;
  const previousPending = existing?.enrichQueue?.length ?? 0;
  const sessionInitial =
    mode === "reset"
      ? enrichPending > 0
        ? enrichPending
        : undefined
      : existing?.enrichSessionInitialPending != null
        ? existing.enrichSessionInitialPending +
          Math.max(enrichPending - previousPending, 0)
        : enrichPending > 0
          ? enrichPending + (existing?.enrichProcessedTotal ?? 0)
          : existing?.enrichSessionInitialPending;

  return {
    scannedAt: new Date().toISOString(),
    range: result.range,
    category: "expiring",
    paginationVersion:
      mode === "reset"
        ? 2
        : Math.max(existing?.paginationVersion ?? 1, result.paginationVersion ?? 2, 2),
    nextApiPage: result.nextApiPage,
    apiCursor: result.apiCursor,
    pageSize: result.pageSize,
    hasMore: result.hasMore,
    items: result.items,
    rejected: result.rejected,
    enrichQueue: result.enrichQueue,
    enrichPaused: mode === "append" ? Boolean(existing?.enrichPaused) : false,
    enrichProcessedTotal:
      mode === "append" ? (existing?.enrichProcessedTotal ?? 0) : 0,
    enrichEmailsFoundTotal:
      mode === "append" ? (existing?.enrichEmailsFoundTotal ?? 0) : 0,
    enrichSessionInitialPending: sessionInitial,
  };
}

export function applyEnrichResult(
  queue: OutreachQueue,
  result: EnrichBatchResult
): OutreachQueue {
  return {
    ...queue,
    scannedAt: new Date().toISOString(),
    items: result.items,
    rejected: result.rejected,
    enrichQueue: result.enrichQueue,
  };
}
