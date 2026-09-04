import { classifyEmail } from "./email-filter";
import { isAllowedNewRegOkved } from "./okved";
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
import {
  getNewRegistrationsRange,
  ruDateToIso as checkoRuDateToIso,
  scanCheckoNewRegistrations,
  enrichCheckoCompanyEmails,
  checkoCompanyToDeclaration,
} from "./checko";
import { isCheckoBlocked } from "./checko-guard";
import {
  CHECKO_PAGINATION_VERSION,
  checkoDateSlices,
  cursorFromCheckoQueue,
  describeCheckoCursor,
  freshCheckoCursor,
  getCheckoSortQuery,
  isCheckoCursorExhausted,
  rotateCheckoCursor,
} from "./checko-pagination";
import { isNewRegistrationsCategory, isWbSellersCategory } from "./category";
import { lookupCheckoCompanyByInn } from "./checko";
import {
  getWbSellersRange,
  rememberWbSeller,
  scanWbSellers,
  wasWbInnSearchedOnChecko,
  wbSellerToDeclaration,
  type WbSellerCard,
} from "./wb-sellers";
import { readOutreachQueue, writeOutreachQueue } from "./queue";
import { isEndDateInRange, isEnrichItemInRange, pruneOutreachQueue } from "./queue-cleanup";
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
  /** Для ночного cron: prune/метаданные очереди при узком scan range */
  queueRange?: { from: string; to: string };
  /** Ночной cron: новый курсор и узкий фильтр, без продолжения полного обхода */
  dailyScan?: boolean;
  existingQueue?: OutreachQueue | null;
  category?: OutreachCategory;
  /** ОГРН/id, которые не нужно тянуть с checko (например, уже на проде). */
  skipIds?: Iterable<number>;
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
  /** checko: капча/лимит — не продолжать enrich */
  blocked?: boolean;
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
  if (
    isNewRegistrationsCategory(category) ||
    isWbSellersCategory(category)
  ) {
    const { status, reason } = classifyEmail(doc.applicant?.email);
    return {
      ...doc,
      emailStatus: status,
      emailRejectReason: reason,
    };
  }
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

function collectKnownIds(
  queue: OutreachQueue | null,
  skipIds?: Iterable<number>
): Set<number> {
  const ids = new Set<number>();
  if (queue) {
    for (const item of [
      ...queue.items,
      ...queue.rejected,
      ...queue.enrichQueue,
    ]) {
      ids.add(item.id);
    }
  }
  for (const raw of skipIds ?? []) {
    const id = Number(raw);
    if (Number.isFinite(id)) ids.add(id);
  }
  return ids;
}

async function bulkLoadCheckoList(
  options: BulkLoadListOptions
): Promise<BulkLoadListResult> {
  const scanRange = options.range ?? getNewRegistrationsRange();
  const queueRange = options.queueRange ?? scanRange;
  const dailyScan = Boolean(options.dailyScan);
  const maxItems = Math.min(
    Math.max(options.maxItems ?? DEFAULT_MAX_ITEMS, 10),
    1000
  );
  const mode = options.mode ?? "reset";
  const existing = mode === "append" ? (options.existingQueue ?? null) : null;

  let paginationVersion =
    mode === "append"
      ? Math.max(existing?.paginationVersion ?? 1, CHECKO_PAGINATION_VERSION)
      : CHECKO_PAGINATION_VERSION;
  let dateSlices = checkoDateSlices(scanRange, paginationVersion);
  let cursor =
    dailyScan || mode !== "append"
      ? freshCheckoCursor()
      : cursorFromCheckoQueue(existing);

  if (dailyScan) {
    paginationVersion = CHECKO_PAGINATION_VERSION;
    dateSlices = checkoDateSlices(scanRange, paginationVersion);
    cursor = freshCheckoCursor();
  }

  if (
    mode === "append" &&
    existing &&
    !dailyScan &&
    isCheckoCursorExhausted(cursor, dateSlices.length)
  ) {
    const mergedEnrich = existing.enrichQueue ?? [];
    return {
      range: queueRange,
      nextApiPage: cursor.page,
      apiCursor: cursor,
      pageSize: existing.pageSize ?? 25,
      hasMore: false,
      items: existing.items,
      rejected: existing.rejected,
      enrichQueue: mergedEnrich,
      loadedFromApi: 0,
      addedNew: 0,
      emailsFromList: 0,
      cursorLabel: `${describeCheckoCursor(cursor, dateSlices)} (исчерпано)`,
      paginationVersion,
    };
  }

  const knownIds = collectKnownIds(existing, options.skipIds);
  const listDelay = Number(process.env.OUTREACH_CHECKO_DELAY_MS || 1800);

  const items: OutreachQueueItem[] = [];
  const rejected: OutreachQueueItem[] = [];
  const enrichQueue: FsaDeclaration[] = [];
  let emailsFromList = 0;
  let newIdsCollected = 0;
  let hasMore = true;
  let exhausted = false;
  let pagesFetchedTotal = 0;
  let rotationSkips = 0;
  const maxRotationSkips = dateSlices.length;

  while (
    newIdsCollected < maxItems &&
    !exhausted &&
    rotationSkips < maxRotationSkips
  ) {
    const slice = dateSlices[cursor.sliceIndex] ?? dateSlices[0];
    const sortQuery = getCheckoSortQuery(cursor.sortIndex);

    const scan = await scanCheckoNewRegistrations({
      dateFrom: checkoRuDateToIso(slice.from),
      dateTo: checkoRuDateToIso(slice.to),
      listOnly: true,
      emailsOnly: false,
      maxItems: maxItems - newIdsCollected,
      startPage: Math.max(cursor.page, 1),
      skipOgrns: [...knownIds].map(String),
      sortQuery,
      delayMs: listDelay,
      onPageProgress: (stats) => {
        console.info(
          `[checko list] ${describeCheckoCursor(cursor, dateSlices)} | page ${stats.page}: +${stats.newCount} new, ${stats.skipCount} skip / ${stats.total}`
        );
      },
    });

    pagesFetchedTotal += scan.pagesFetched;

    for (const declaration of scan.declarations) {
      if (knownIds.has(declaration.id)) continue;
      knownIds.add(declaration.id);
      newIdsCollected += 1;

      const email = declaration.applicant?.email?.trim();
      if (!email) {
        enrichQueue.push(declaration);
        continue;
      }

      emailsFromList += 1;
      const verdict = classifyEmail(email);
      const row: OutreachQueueItem = {
        ...declaration,
        applicant: {
          ...declaration.applicant,
          email: email.toLowerCase(),
        },
        emailStatus: verdict.status,
        emailRejectReason: verdict.reason,
      };
      if (row.emailStatus === "eligible") items.push(row);
      else rejected.push(row);
    }

    if (scan.hasMore && scan.nextPage > cursor.page) {
      cursor = { ...cursor, page: scan.nextPage };
      hasMore = true;
      continue;
    }

    const rotated = rotateCheckoCursor(cursor, dateSlices.length);
    if (rotated.exhausted) {
      exhausted = true;
      hasMore = false;
      break;
    }
    cursor = rotated.cursor;
    rotationSkips += 1;
    hasMore = true;
  }

  const mergedItems =
    mode === "append" && existing ? [...existing.items, ...items] : items;
  const mergedRejected =
    mode === "append" && existing
      ? [...existing.rejected, ...rejected]
      : rejected;
  const mergedEnrich =
    mode === "append" && existing
      ? [...existing.enrichQueue, ...enrichQueue]
      : enrichQueue;

  const pruned = pruneOutreachQueue(
    mergedItems,
    mergedRejected,
    queueRange,
    "new_registrations"
  );

  const addedAfterPrune =
    mode === "append" && existing
      ? Math.max(
          pruned.items.length +
            pruned.rejected.length -
            ((existing.items?.length ?? 0) + (existing.rejected?.length ?? 0)),
          0
        )
      : pruned.items.length + pruned.rejected.length;

  return {
    range: queueRange,
    nextApiPage: cursor.page,
    apiCursor: {
      page: Math.max(cursor.page, 1),
      sortIndex: cursor.sortIndex,
      sliceIndex: cursor.sliceIndex,
    },
    pageSize: 25,
    hasMore,
    items: pruned.items,
    rejected: pruned.rejected,
    enrichQueue: mergedEnrich.filter((item) =>
      isEnrichItemInRange(item, queueRange, "new_registrations")
    ),
    loadedFromApi: newIdsCollected,
    addedNew: addedAfterPrune,
    emailsFromList,
    cursorLabel: `${describeCheckoCursor(cursor, dateSlices)}${
      hasMore ? "+" : ""
    } (${pagesFetchedTotal} стр., email в фоне)`,
    paginationVersion,
  };
}

async function bulkLoadWbList(
  options: BulkLoadListOptions
): Promise<BulkLoadListResult> {
  const queueRange = options.queueRange ?? getWbSellersRange();
  const maxItems = Math.min(
    Math.max(options.maxItems ?? DEFAULT_MAX_ITEMS, 10),
    300
  );
  const mode = options.mode ?? "reset";
  const existing = mode === "append" ? (options.existingQueue ?? null) : null;
  const startPage = Math.max(existing?.apiCursor?.page ?? 1, 1);

  const skipSellerIds = new Set<string>();
  if (existing) {
    for (const row of [
      ...(existing.items ?? []),
      ...(existing.rejected ?? []),
      ...(existing.enrichQueue ?? []),
    ]) {
      if (row.number) skipSellerIds.add(String(row.number));
    }
  }

  const scan = await scanWbSellers({
    startPage: mode === "reset" ? 1 : startPage,
    maxSellers: maxItems,
    maxPages: Math.min(Math.max(Math.ceil(maxItems / 15), 2), 20),
    skipSellerIds,
  });

  const items: OutreachQueueItem[] = [];
  const rejected: OutreachQueueItem[] = [];
  const enrichQueue: FsaDeclaration[] = [];
  let emailsFromList = 0;

  for (const card of scan.sellers) {
    const doc = scan.declarations.find(
      (d) => String(d.number) === card.sellerId
    );
    if (!doc) continue;
    if (card.email) {
      emailsFromList += 1;
      const row = toQueueItem(doc, "wb_sellers");
      if (row.emailStatus === "eligible") items.push(row);
      else rejected.push(row);
      continue;
    }
    if (card.inn) {
      enrichQueue.push(doc);
      continue;
    }
    rejected.push({
      ...doc,
      emailStatus: "no_email",
      emailRejectReason: "email_missing",
    });
  }

  const merged = pruneOutreachQueue(
    mergeUnique(mode === "append" ? (existing?.items ?? []) : [], items),
    mergeUnique(mode === "append" ? (existing?.rejected ?? []) : [], rejected),
    queueRange,
    "wb_sellers"
  );

  return {
    range: queueRange,
    nextApiPage: scan.nextPage,
    apiCursor: { page: scan.nextPage, sortIndex: 0, sliceIndex: 0 },
    pageSize: 20,
    hasMore: scan.hasMore,
    items: merged.items,
    rejected: merged.rejected,
    enrichQueue: mergeUniqueDeclarations(
      mode === "append" ? (existing?.enrichQueue ?? []) : [],
      enrichQueue
    ),
    loadedFromApi: scan.sellers.length,
    addedNew: scan.sellers.length,
    emailsFromList,
    cursorLabel: "WB главная",
    paginationVersion: 2,
  };
}

/** Пробная / ручная карточка WB → сразу в очередь рассылки. */
export function upsertWbSellerCardToQueue(
  card: WbSellerCard,
  emailSource?: "wb" | "checko"
): {
  list: "eligible" | "rejected" | "enrich" | "none";
  emailStatus?: string;
} {
  const range = getWbSellersRange();
  const existing = readOutreachQueue("wb_sellers");
  const doc = wbSellerToDeclaration(card);
  if (emailSource === "checko") {
    doc.productGroup = "checko";
  } else if (card.email) {
    doc.productGroup = "WB";
  } else if (card.inn) {
    doc.productGroup = "ИНН";
  }

  let items = existing?.items ?? [];
  let rejected = existing?.rejected ?? [];
  let enrichQueue = existing?.enrichQueue ?? [];
  const id = doc.id;
  const number = String(doc.number);

  items = items.filter((row) => row.id !== id && String(row.number) !== number);
  rejected = rejected.filter(
    (row) => row.id !== id && String(row.number) !== number
  );
  enrichQueue = enrichQueue.filter(
    (row) => row.id !== id && String(row.number) !== number
  );

  let list: "eligible" | "rejected" | "enrich" | "none" = "none";
  let emailStatus: string | undefined;

  if (card.email) {
    const row = toQueueItem(doc, "wb_sellers");
    emailStatus = row.emailStatus;
    if (row.emailStatus === "eligible") {
      items = mergeUnique(items, [row]);
      list = "eligible";
    } else {
      rejected = mergeUnique(rejected, [row]);
      list = "rejected";
    }
  } else if (card.inn) {
    enrichQueue = mergeUniqueDeclarations(enrichQueue, [doc]);
    list = "enrich";
  } else {
    rejected = mergeUnique(rejected, [
      {
        ...doc,
        emailStatus: "no_email",
        emailRejectReason: "email_missing",
      },
    ]);
    list = "rejected";
  }

  const pruned = pruneOutreachQueue(items, rejected, range, "wb_sellers");
  writeOutreachQueue({
    scannedAt: existing?.scannedAt || new Date().toISOString(),
    range: existing?.range ?? range,
    category: "wb_sellers",
    paginationVersion: existing?.paginationVersion ?? 2,
    nextApiPage: existing?.nextApiPage ?? 1,
    apiCursor: existing?.apiCursor ?? { page: 1, sortIndex: 0, sliceIndex: 0 },
    pageSize: existing?.pageSize ?? 20,
    hasMore: existing?.hasMore ?? true,
    items: pruned.items,
    rejected: pruned.rejected,
    enrichQueue,
    enrichPaused: existing?.enrichPaused,
    enrichProcessedTotal: existing?.enrichProcessedTotal,
    enrichEmailsFoundTotal: existing?.enrichEmailsFoundTotal,
    enrichSessionInitialPending: existing?.enrichSessionInitialPending,
  });

  return { list, emailStatus };
}

function mergeUniqueDeclarations(
  current: FsaDeclaration[],
  incoming: FsaDeclaration[]
): FsaDeclaration[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** Быстрая загрузка списка — ФСА, checko или WB в зависимости от категории */
export async function bulkLoadList(
  options: BulkLoadListOptions = {}
): Promise<BulkLoadListResult> {
  const category = options.category ?? "expiring";
  if (isNewRegistrationsCategory(category)) {
    return bulkLoadCheckoList(options);
  }
  if (isWbSellersCategory(category)) {
    return bulkLoadWbList(options);
  }

  const scanRange = options.range ?? getExpiringMonthRange();
  const queueRange = options.queueRange ?? scanRange;
  const dailyScan = Boolean(options.dailyScan);
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
  let dateSlices = dateSlicesForLoad(scanRange, { mode, paginationVersion });
  let cursor =
    dailyScan || mode !== "append"
      ? freshFsaCursor()
      : cursorFromQueue(existing);

  if (dailyScan) {
    paginationVersion = FSA_PAGINATION_VERSION;
    dateSlices = dateSlicesForLoad(scanRange, { mode: "append", paginationVersion });
    cursor = freshFsaCursor();
  }

  // Если прошлый обход помечен исчерпанным — начинаем сетку sort×slice заново.
  // knownIds сохраняем: уже виденные не пойдут в enrich повторно, но новые id
  // из других сортировок/направлений подтянутся (типичный кейс сертификатов).
  if (
    mode === "append" &&
    existing &&
    !dailyScan &&
    (existing.hasMore === false ||
      isFsaCursorExhausted(cursor, dateSlices.length))
  ) {
    cursor = freshFsaCursor();
    paginationVersion = FSA_PAGINATION_VERSION;
    dateSlices = dateSlicesForLoad(scanRange, { mode, paginationVersion });
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
          const upgraded = upgradeLegacyPagination(scanRange);
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
            const upgraded = upgradeLegacyPagination(scanRange);
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
          const upgraded = upgradeLegacyPagination(scanRange);
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
          const upgraded = upgradeLegacyPagination(scanRange);
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
          const upgraded = upgradeLegacyPagination(scanRange);
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
      .filter((item) => isEndDateInRange(item, scanRange))
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
    queueRange,
    category
  );

  return {
    range: queueRange,
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
  if (isWbSellersCategory(queue.category)) {
    const batch = queue.enrichQueue.slice(0, Math.min(batchSize, 8));
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

    const delayMs = Math.min(
      Math.max(Number(process.env.OUTREACH_CHECKO_ENRICH_DELAY_MS || 9000), 2000),
      30_000
    );
    const now = new Date().toISOString();
    const found: OutreachQueueItem[] = [];
    const rejectedExtra: OutreachQueueItem[] = [];
    let emailsFound = 0;

    for (const item of batch) {
      if (options?.shouldAbort?.()) break;
      const inn = item.applicant?.inn?.replace(/\D/g, "") || "";
      const sellerId = String(item.number || item.id);
      if (!inn) {
        rememberWbSeller({
          sellerId,
          name: item.applicant?.shortName,
          searchedWbAt: now,
          searchedCheckoAt: now,
        });
        rejectedExtra.push({
          ...item,
          emailStatus: "no_email",
          emailRejectReason: "email_missing",
        });
        continue;
      }
      if (wasWbInnSearchedOnChecko(inn)) {
        rejectedExtra.push({
          ...item,
          emailStatus: "no_email",
          emailRejectReason: "email_missing",
        });
        continue;
      }
      await sleep(delayMs);
      try {
        const company = await lookupCheckoCompanyByInn(inn);
        rememberWbSeller({
          sellerId,
          inn,
          name: item.applicant?.shortName || company?.shortName,
          email: company?.email,
          emailSource: company?.email ? "checko" : undefined,
          searchedWbAt: now,
          searchedCheckoAt: now,
        });
        if (company?.email) {
          emailsFound += 1;
          const updated = toQueueItem(
            {
              ...item,
              applicant: {
                ...item.applicant,
                email: company.email,
                shortName:
                  item.applicant?.shortName || company.shortName,
                fullName: item.applicant?.fullName || company.fullName,
              },
              productGroup: "checko",
            },
            "wb_sellers"
          );
          if (updated.emailStatus === "eligible") found.push(updated);
          else rejectedExtra.push(updated);
        } else {
          rejectedExtra.push({
            ...item,
            emailStatus: "no_email",
            emailRejectReason: "email_missing",
          });
        }
      } catch {
        rejectedExtra.push({
          ...item,
          emailStatus: "no_email",
          emailRejectReason: "email_missing",
        });
      }
    }

    const rest = queue.enrichQueue.slice(batch.length);
    const merged = pruneOutreachQueue(
      mergeUnique(queue.items, found),
      mergeUnique(queue.rejected, rejectedExtra),
      queue.range,
      "wb_sellers"
    );
    return {
      processed: batch.length,
      requeued: rest.length,
      emailsFound,
      enrichedFromCards: emailsFound,
      enrichPending: rest.length,
      items: merged.items,
      rejected: merged.rejected,
      enrichQueue: rest,
    };
  }

  // Checko: несколько карточек в ОДНОЙ сессии браузера, паузы между ними.
  // Раньше брали по 1 и рвали job — UI снова показывал «Продолжить».
  if (isNewRegistrationsCategory(queue.category)) {
    if (isCheckoBlocked()) {
      return {
        processed: 0,
        requeued: queue.enrichQueue.length,
        emailsFound: 0,
        enrichedFromCards: 0,
        enrichPending: queue.enrichQueue.length,
        items: queue.items,
        rejected: queue.rejected,
        enrichQueue: queue.enrichQueue,
        blocked: true,
      };
    }

    const checkoBatchMax = process.env.OUTREACH_CHECKO_FAST === "1" ? 50 : 25;
    const checkoBatchSize = Math.min(
      Math.max(Number(process.env.OUTREACH_CHECKO_ENRICH_PER_JOB || 12), 1),
      checkoBatchMax
    );
    const batch = queue.enrichQueue.slice(0, checkoBatchSize);
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

    if (options?.shouldAbort?.()) {
      return {
        processed: 0,
        requeued: queue.enrichQueue.length,
        emailsFound: 0,
        enrichedFromCards: 0,
        enrichPending: queue.enrichQueue.length,
        items: queue.items,
        rejected: queue.rejected,
        enrichQueue: queue.enrichQueue,
      };
    }

    const withEmail: OutreachQueueItem[] = [];
    const stillNeed: FsaDeclaration[] = [];
    const rejectedExtra: OutreachQueueItem[] = [];
    let emailsFound = 0;
    let blocked = false;

    const urls = batch.map((item) => item.registryUrl || "");
    const results = await enrichCheckoCompanyEmails(
      urls.filter(Boolean),
      { shouldAbort: options?.shouldAbort }
    );
    // Сопоставляем по порядку (batch без url отдельно).
    let resultIdx = 0;
    for (const item of batch) {
      const url = item.registryUrl || "";
      if (!url) {
        rejectedExtra.push({
          ...item,
          emailStatus: "no_email",
          emailRejectReason: "нет ссылки на карточку checko",
        });
        continue;
      }
      const result = results[resultIdx++];
      if (!result || result.blocked) {
        blocked = true;
        stillNeed.push(item);
        continue;
      }
      if (result.error || !result.company) {
        if (/CHECKO_ACCESS_LIMITED|капч|большое количество/i.test(result.error || "")) {
          blocked = true;
          stillNeed.push(item);
          continue;
        }
        if (process.env.OUTREACH_DEBUG === "1" || process.env.NODE_ENV !== "production") {
          console.warn(`[checko-enrich] ${item.id}: ${result.error || "empty"}`);
        }
        stillNeed.push(item);
        continue;
      }

      const company = result.company;
      const email = company.email?.trim();
      const mergedDecl = checkoCompanyToDeclaration({
        ...company,
        path: company.path,
        ogrn: company.ogrn || String(item.applicant?.ogrn || item.id),
        shortName: company.shortName || item.applicant?.shortName,
        fullName: company.fullName || item.applicant?.fullName,
        inn: company.inn || item.applicant?.inn,
        okved: company.okved || item.productName,
      });
      if (!isAllowedNewRegOkved(mergedDecl)) {
        rejectedExtra.push({
          ...mergedDecl,
          id: item.id,
          emailStatus: "rejected",
          emailRejectReason: "okved_not_allowed",
        });
        continue;
      }
      if (!email) {
        rejectedExtra.push({
          ...mergedDecl,
          id: item.id,
          emailStatus: "no_email",
          emailRejectReason: "нет email на карточке checko",
        });
        continue;
      }
      emailsFound += 1;
      const verdict = classifyEmail(email);
      if (process.env.OUTREACH_DEBUG === "1" || process.env.NODE_ENV !== "production") {
        console.info(
          `[checko-enrich] → ${verdict.status} id=${item.id} ${email} (${verdict.reason || "ok"})`
        );
      }
      const row: OutreachQueueItem = {
        ...mergedDecl,
        id: item.id,
        applicant: {
          ...mergedDecl.applicant,
          email: email.toLowerCase(),
        },
        emailStatus: verdict.status,
        emailRejectReason: verdict.reason,
      };
      if (row.emailStatus === "eligible") withEmail.push(row);
      else rejectedExtra.push(row);
    }

    const enrichQueue = [
      ...stillNeed,
      ...queue.enrichQueue.slice(batch.length),
    ];

    return {
      processed: withEmail.length + rejectedExtra.length,
      requeued: stillNeed.length,
      emailsFound,
      enrichedFromCards: emailsFound,
      enrichPending: enrichQueue.length,
      items: [...queue.items, ...withEmail],
      rejected: [...queue.rejected, ...rejectedExtra],
      enrichQueue,
      blocked,
    };
  }

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
    queueRange?: { from: string; to: string };
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
    range: options?.queueRange ?? result.range,
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
