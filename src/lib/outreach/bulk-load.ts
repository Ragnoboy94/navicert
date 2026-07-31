import { classifyEmail } from "./email-filter";
import { enrichApplicantsFromCards } from "./enrich-applicants";
import {
  certificateApplicantUrl,
  fetchCertificate,
  normalizeCertificate,
  searchExpiringCertificates,
  fetchDeclaration,
  normalizeDeclaration,
  searchExpiringDeclarations,
  declarationApplicantUrl,
} from "./fsa";
import {
  ensureFsaSession,
  formatFsaConnectionError,
} from "./fsa-connection";
import { invalidateFsaBearerToken } from "./bearer";
import {
  cursorFromQueue,
  cursorNeedsRotation,
  describeFsaCursor,
  freshFsaCursor,
  getSortField,
  healFsaPagination,
  isFsaCursorExhausted,
  isFsaPageLimitError,
  rotateFsaCursor,
  ruDateToIso,
  dateSlicesForLoad,
  upgradeLegacyPagination,
  FSA_PAGINATION_VERSION,
  type FsaLoadCursor,
} from "./fsa-pagination";
import { getExpiringMonthRange } from "./queue";
import { isEndDateInRange, pruneOutreachQueue } from "./queue-cleanup";
import type {
  FsaDeclaration,
  OutreachQueue,
  OutreachQueueItem,
  OutreachCategory,
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

function isTransientListError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  return /timeout|timed out|abort|econnreset|econnrefused|enotfound|socket hang up|network|fetch failed|all fsa proxies failed|503|502|504|429/i.test(
    `${msg} ${cause}`
  );
}

export type BulkLoadMode = "reset" | "append";

export type BulkLoadListOptions = {
  mode?: BulkLoadMode;
  maxItems?: number;
  pageSize?: number;
  range?: { from: string; to: string };
  existingQueue?: OutreachQueue | null;
  category?: OutreachCategory;
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
    Math.max(Number(process.env.OUTREACH_CARD_BATCH || 16), 1),
    32
  );
}

export function getApiEnrichConcurrency(): number {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_API_ENRICH_CONCURRENCY || 8), 1),
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

function toQueueItem(
  doc: FsaDeclaration,
  category: OutreachCategory
): OutreachQueueItem {
  const normalize = category === "expiring_certificates"
    ? normalizeCertificate
    : normalizeDeclaration;
  const normalized = normalize(doc);
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
  incoming: FsaDeclaration[],
  category: OutreachCategory
): FsaDeclaration[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  const normalize =
    category === "expiring_certificates"
      ? normalizeCertificate
      : normalizeDeclaration;
  for (const item of incoming) {
    if (!normalize(item).applicant?.email?.trim()) {
      byId.set(item.id, normalize(item));
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

type ApiEnrichOutcome = {
  item: FsaDeclaration;
  /** GET /declarations/{id} успешен: контакты в ответе полные, Playwright не нужен */
  detailFetched: boolean;
};

async function enrichEmailFromApi(
  declaration: FsaDeclaration,
  category: OutreachCategory
): Promise<ApiEnrichOutcome> {
  const normalize =
    category === "expiring_certificates"
      ? normalizeCertificate
      : normalizeDeclaration;
  const base = normalize(declaration);

  // RSS: list/get работает, а GET /certificates/{id} у ФСА часто не отвечает
  // (таймауты → батч обогащения «висит», кнопка кажется мёртвой).
  // Email для сертификатов берём со страницы заявителя через Playwright.
  if (category === "expiring_certificates") {
    return { item: base, detailFetched: false };
  }

  try {
    const detail = normalize(await fetchDeclaration(base.id));
    // Детальная карточка иногда отдаёт пустые даты — не затираем список.
    const item = normalize({
      ...base,
      ...detail,
      registrationDate:
        detail.registrationDate?.trim() || base.registrationDate,
      endDate: detail.endDate?.trim() || base.endDate,
      applicant: {
        ...base.applicant,
        ...detail.applicant,
        email: detail.applicant?.email?.trim() || base.applicant?.email,
        phone: detail.applicant?.phone?.trim() || base.applicant?.phone,
      },
    });
    return { item, detailFetched: true };
  } catch {
    return { item: base, detailFetched: false };
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
  const category = options.category ?? "expiring";
  const pageSize = Math.min(
    Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 10),
    100
  );
  const maxItems = Math.min(
    Math.max(options.maxItems ?? DEFAULT_MAX_ITEMS, 10),
    1000
  );
  const mode = options.mode ?? "reset";
  const normalize = category === "expiring_certificates" ? normalizeCertificate : normalizeDeclaration;
  const searchExpiring = category === "expiring_certificates" ? searchExpiringCertificates : searchExpiringDeclarations;
  const fetchById = category === "expiring_certificates" ? fetchCertificate : fetchDeclaration;
  const declarationUrl = category === "expiring_certificates" ? certificateApplicantUrl : declarationApplicantUrl;
  let existing = mode === "append" ? (options.existingQueue ?? null) : null;
  if (existing) {
    existing = healFsaPagination(existing).queue;
  }

  let paginationVersion =
    mode === "append"
      ? Math.max(existing?.paginationVersion ?? 1, FSA_PAGINATION_VERSION)
      : FSA_PAGINATION_VERSION;
  let dateSlices = dateSlicesForLoad(range, { mode, paginationVersion });
  let cursor =
    mode === "append"
      ? cursorFromQueue(existing)
      : freshFsaCursor();

  // Если прошлый обход помечен исчерпанным — начинаем сетку sort×slice заново.
  // knownIds сохраняем: уже виденные не пойдут в enrich повторно, но новые id
  // из других сортировок/направлений подтянутся (типичный кейс сертификатов).
  if (
    mode === "append" &&
    existing &&
    (existing.hasMore === false ||
      isFsaCursorExhausted(cursor, dateSlices.length))
  ) {
    cursor = freshFsaCursor();
    paginationVersion = FSA_PAGINATION_VERSION;
    dateSlices = dateSlicesForLoad(range, { mode, paginationVersion });
  }

  const knownIds = collectKnownIds(existing);

  let sessionToken = (await ensureFsaSession()).token;

  const rawDeclarations: FsaDeclaration[] = [];
  let newIdsCollected = 0;
  let hasMore = true;
  let exhausted = false;
  let fetchAttempts = 0;
  let rotationSkips = 0;
  const maxFetchAttempts = Math.max(maxItems / pageSize + 48, 64);
  const maxRotationSkips = 32;

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
      let transientRetries = 0;
      while (true) {
        try {
          batch = await searchExpiring(
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
          if (transientRetries < 3 && isTransientListError(error)) {
            transientRetries += 1;
            await sleep(800 * 2 ** (transientRetries - 1));
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
      // Уже что-то собрали — сохраняем частичный результат вместо полной ошибки UI
      if (rawDeclarations.length > 0 || newIdsCollected > 0) {
        console.warn(
          "bulkLoadList soft-stop after transient FSA errors:",
          formatFsaConnectionError(error)
        );
        hasMore = true;
        break;
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
    rawDeclarations
      .map(normalize)
      .filter((item) => isEndDateInRange(item, range))
  );

  const withEmail = inRange.filter((item) => item.applicant?.email?.trim());
  const needsEnrich = inRange.filter((item) => !item.applicant?.email?.trim());

  const classified = withEmail.map((item) => toQueueItem(item, category));
  const eligible = classified.filter((item) => item.emailStatus === "eligible");
  const rejected = classified.filter(
    (item) =>
      item.emailStatus === "rejected" || item.emailStatus === "no_email"
  );

  const baseItems = mode === "append" ? (existing?.items ?? []) : [];
  const baseRejected = mode === "append" ? (existing?.rejected ?? []) : [];
  const baseEnrichQueue =
    mode === "append" ? (existing?.enrichQueue ?? []) : [];

  const merged = pruneOutreachQueue(
    mergeUnique(baseItems, eligible),
    mergeUnique(baseRejected, rejected),
    range,
    category
  );

  return {
    range,
    nextApiPage: cursor.page,
    apiCursor: cursor,
    pageSize,
    hasMore,
    items: merged.items,
    rejected: merged.rejected,
    enrichQueue: mergeEnrichQueue(baseEnrichQueue, needsEnrich, category),
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
  const normalize =
    queue.category === "expiring_certificates"
      ? normalizeCertificate
      : normalizeDeclaration;
  const batch = queue.enrichQueue.slice(0, batchSize).map(normalize);
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

  const apiOutcomes = await mapWithConcurrency(
    batch,
    getApiEnrichConcurrency(),
    async (item) => {
      try {
        return await enrichEmailFromApi(item, queue.category);
      } catch {
        problemDeclaration = {
          id: item.id,
          url:
            item.registryUrl ||
            (queue.category === "expiring_certificates"
              ? certificateApplicantUrl(item.id)
              : declarationApplicantUrl(item.id)),
        };
        return {
          item:
            queue.category === "expiring_certificates"
              ? normalizeCertificate(item)
              : normalizeDeclaration(item),
          detailFetched: false,
        } satisfies ApiEnrichOutcome;
      }
    }
  );

  const withEmail = apiOutcomes
    .filter((row) => row.item.applicant?.email?.trim())
    .map((row) => row.item);

  // Декларации: email в ФСА лежит в applicant.contacts (idContactType=4, value с @).
  // Если детальная карточка пришла без email — на сайте его тоже нет, Playwright не нужен.
  // Сертификаты / сбой API — оставляем для карточек.
  // Без email после подтверждения в rejected/UI не кладём — просто выпадают из enrich.
  const stillMissing = apiOutcomes
    .filter(
      (row) =>
        !row.item.applicant?.email?.trim() &&
        !(row.detailFetched && queue.category === "expiring")
    )
    .map((row) => row.item);

  const cardBatch =
    options?.shouldAbort?.() === true
      ? []
      : stillMissing.slice(0, getCardEnrichPerBatch());
  let cardEnriched: FsaDeclaration[] = [];
  if (cardBatch.length > 0) {
    try {
      cardEnriched = await enrichApplicantsFromCards(
        cardBatch,
        queue.category
      );
    } catch (error) {
      problemDeclaration = {
        id: cardBatch[0].id,
        url:
          cardBatch[0].registryUrl ||
          (queue.category === "expiring_certificates"
            ? certificateApplicantUrl(cardBatch[0].id)
            : declarationApplicantUrl(cardBatch[0].id)),
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

  const classified = resolved.map((item) => toQueueItem(item, queue.category));
  const eligible = classified.filter((item) => item.emailStatus === "eligible");
  // В rejected на диске: и личные ящики, и no_email (чтобы не обогащать повторно).
  // В UI no_email не показываем.
  const rejected = classified.filter(
    (item) =>
      item.emailStatus === "rejected" || item.emailStatus === "no_email"
  );

  const cardNoEmail = cardEnriched.filter(
    (item) => !item.applicant?.email?.trim()
  );
  // Если Playwright вернул карточку без имени и без email — страница не прогрузилась.
  // Не списываем как no_email, возвращаем в хвост.
  const scrapeFailed = cardNoEmail.filter(
    (item) =>
      !item.applicant?.shortName?.trim() && !item.applicant?.fullName?.trim()
  );
  const scrapeFailedIds = new Set(scrapeFailed.map((item) => item.id));
  const confirmedNoEmail = [
    ...apiOutcomes
      .filter(
        (row) =>
          row.detailFetched &&
          !row.item.applicant?.email?.trim() &&
          queue.category === "expiring"
      )
      .map((row) => row.item),
    ...cardNoEmail.filter((item) => !scrapeFailedIds.has(item.id)),
  ];
  const noEmailRejected = confirmedNoEmail.map((item) =>
    toQueueItem(item, queue.category)
  );

  // Без email после успешного API/карточки — убираем из enrich, помним в rejected (скрыто в UI).
  // scrapeFailed — в хвост на повтор.
  const stillNeedEnrich = [
    ...stillMissing.filter((item) => !cardEnrichedIds.has(item.id)),
    ...scrapeFailed,
  ];

  const remainingQueue = [
    ...queue.enrichQueue.slice(batch.length),
    ...stillNeedEnrich,
  ];

  const merged = pruneOutreachQueue(
    mergeUnique(queue.items, eligible),
    mergeUnique(mergeUnique(queue.rejected, rejected), noEmailRejected),
    queue.range,
    queue.category
  );

  const enrichQueue = mergeEnrichQueue([], remainingQueue, queue.category);
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
  options?: {
    mode?: "reset" | "append";
    existing?: OutreachQueue | null;
    category?: OutreachCategory;
  }
): OutreachQueue {
  const mode = options?.mode ?? "reset";
  const existing = options?.existing;
  const category = options?.category ?? existing?.category ?? "expiring";
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
    category,
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
