import fs from "fs";
import path from "path";
import { normalizeCertificate, normalizeDeclaration } from "./fsa";
import { pruneOutreachQueue, isEnrichItemInRange } from "./queue-cleanup";
import { healFsaPagination } from "./fsa-pagination";
import { getNewRegistrationsRange } from "./checko-range";
import { getWbSellersRange } from "./wb-sellers";
import type { OutreachQueue } from "./types";
import type { OutreachCategory } from "./types";

function queuePath(category: OutreachCategory): string {
  const file =
    category === "expiring_certificates"
      ? "outreach-certificates-queue.json"
      : category === "new_registrations"
        ? "outreach-new-registrations-queue.json"
        : category === "wb_sellers"
          ? "outreach-wb-sellers-queue.json"
          : "outreach-queue.json";
  return path.join(process.cwd(), "data", file);
}

type QueueCacheEntry = {
  mtimeMs: number;
  size: number;
  queue: OutreachQueue;
};

const queueCache = new Map<OutreachCategory, QueueCacheEntry>();

function rememberQueue(
  category: OutreachCategory,
  qpath: string,
  queue: OutreachQueue
): OutreachQueue {
  try {
    const st = fs.statSync(qpath);
    queueCache.set(category, {
      mtimeMs: st.mtimeMs,
      size: st.size,
      queue,
    });
  } catch {
    queueCache.delete(category);
  }
  return queue;
}

export function readOutreachQueue(
  category: OutreachCategory = "expiring"
): OutreachQueue | null {
  const qpath = queuePath(category);
  if (!fs.existsSync(qpath)) {
    queueCache.delete(category);
    return null;
  }

  const st = fs.statSync(qpath);
  const hit = queueCache.get(category);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    return hit.queue;
  }

  const text = fs.readFileSync(qpath, "utf-8");
  const raw = JSON.parse(text) as OutreachQueue;
  // Категория берётся из пути файла — иначе запись может уйти в чужой контур
  const stamped: OutreachQueue = { ...raw, category };
  const healedResult =
    category === "new_registrations" || category === "wb_sellers"
      ? { queue: stamped, changed: false }
      : healFsaPagination(stamped);
  const withCategory: OutreachQueue = { ...healedResult.queue, category };
  const prettyPrinted = text.includes("\n  ");
  if (healedResult.changed || raw.category !== category || prettyPrinted) {
    // compact JSON сильно ускоряет последующие parse (файл ~в 2–3 раза меньше)
    writeOutreachQueue(withCategory);
    return rememberQueue(
      category,
      qpath,
      sanitizeOutreachQueue(normalizeQueue(withCategory))
    );
  }
  return rememberQueue(
    category,
    qpath,
    sanitizeOutreachQueue(normalizeQueue(withCategory))
  );
}

/** Убирает отправленные и то, что вне актуального окна.
 *  При сдвиге формулы периода обновляем range и вычищаем старьё вне окна,
 *  но не делаем полный reset очереди с нуля через API. */
export function sanitizeOutreachQueue(queue: OutreachQueue): OutreachQueue {
  const normalized = normalizeQueue(queue);
  const current =
    normalized.category === "new_registrations"
      ? getNewRegistrationsRange()
      : normalized.category === "wb_sellers"
        ? getWbSellersRange()
        : getExpiringMonthRange();
  const rangeChanged =
    !normalized.range ||
    normalized.range.from !== current.from ||
    normalized.range.to !== current.to;
  const range = current;

  const { items, rejected } = pruneOutreachQueue(
    normalized.items,
    normalized.rejected,
    range,
    normalized.category
  );

  const enrichQueue = normalized.enrichQueue.filter((item) =>
    isEnrichItemInRange(item, range, normalized.category)
  );

  const cleaned: OutreachQueue = {
    ...normalized,
    range,
    items,
    rejected,
    enrichQueue,
    ...(rangeChanged
      ? {
          // checko — страницы 1-based; ФСА — с 0. Не смешивать.
          apiCursor: {
            page:
              normalized.category === "new_registrations" ||
              normalized.category === "wb_sellers"
                ? 1
                : 0,
            sortIndex: 0,
            sliceIndex: 0,
          },
          nextApiPage:
            normalized.category === "new_registrations" ||
            normalized.category === "wb_sellers"
              ? 1
              : 0,
          hasMore: true,
          paginationVersion: 2,
        }
      : {}),
  };

  const changed =
    rangeChanged ||
    items.length !== normalized.items.length ||
    rejected.length !== normalized.rejected.length ||
    enrichQueue.length !== normalized.enrichQueue.length;

  if (changed) writeOutreachQueue(cleaned);
  return cleaned;
}

export function writeOutreachQueue(queue: OutreachQueue): void {
  const category = queue.category ?? "expiring";
  const qpath = queuePath(category);
  const dir = path.dirname(qpath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Без pretty-print: меньше диск/RAM/время JSON.parse на проде (~4MB+).
  fs.writeFileSync(qpath, JSON.stringify(normalizeQueue(queue)) + "\n");
  queueCache.delete(category);
}

export function setExcludeFromAutoSend(
  declarationId: number,
  exclude: boolean,
  category: OutreachCategory = "expiring"
): OutreachQueue | null {
  const queue = readOutreachQueue(category);
  if (!queue) return null;

  let found = false;
  const items = queue.items.map((item) => {
    if (item.id !== declarationId) return item;
    found = true;
    return { ...item, excludeFromAutoSend: exclude };
  });

  if (!found) return null;

  const next = { ...queue, items };
  writeOutreachQueue(next);
  return next;
}

function migrateEnrichCounters(queue: OutreachQueue): OutreachQueue {
  const pending = queue.enrichQueue.length;
  const processed = queue.enrichProcessedTotal ?? 0;
  if (pending === 0 || queue.enrichSessionInitialPending != null) return queue;
  // Legacy: processedTotal считал размер батча, а не завершённые карточки
  if (processed > pending + 100) {
    return {
      ...queue,
      enrichProcessedTotal: 0,
      enrichSessionInitialPending: pending,
    };
  }
  return queue;
}

function normalizeQueue(queue: OutreachQueue): OutreachQueue {
  const migrated = migrateEnrichCounters(queue);
  if (queue.category === "new_registrations" || queue.category === "wb_sellers") {
    const apiCursor = migrated.apiCursor ?? {
      page: migrated.nextApiPage ?? 0,
      sortIndex: 0,
      sliceIndex: 0,
    };
    return {
      ...migrated,
      category: queue.category,
      nextApiPage: apiCursor.page,
      apiCursor,
      paginationVersion: Math.max(migrated.paginationVersion ?? 1, 2),
      pageSize: queue.pageSize ?? 25,
      hasMore: queue.hasMore ?? false,
      enrichQueue: queue.enrichQueue ?? [],
      enrichPaused: Boolean(queue.enrichPaused),
      enrichProcessedTotal: queue.enrichProcessedTotal ?? 0,
      enrichEmailsFoundTotal: queue.enrichEmailsFoundTotal ?? 0,
      enrichSessionInitialPending: queue.enrichSessionInitialPending,
      items: queue.items ?? [],
      rejected: queue.rejected ?? [],
    };
  }
  const { queue: healed } = healFsaPagination(migrated);
  const apiCursor = healed.apiCursor ?? {
    page: healed.nextApiPage ?? 0,
    sortIndex: 0,
    sliceIndex: 0,
  };
  const normalize =
    queue.category === "expiring_certificates"
      ? (x: Parameters<typeof normalizeCertificate>[0]) =>
          normalizeCertificate(x)
      : (x: Parameters<typeof normalizeDeclaration>[0]) =>
          normalizeDeclaration(x);
  return {
    ...healed,
    category: queue.category ?? "expiring",
    nextApiPage: apiCursor.page,
    apiCursor,
    paginationVersion: Math.max(healed.paginationVersion ?? 1, 2),
    pageSize: queue.pageSize ?? 100,
    hasMore: queue.hasMore ?? false,
    enrichQueue: (queue.enrichQueue ?? []).map(normalize),
    enrichPaused: Boolean(queue.enrichPaused),
    enrichProcessedTotal: queue.enrichProcessedTotal ?? 0,
    enrichEmailsFoundTotal: queue.enrichEmailsFoundTotal ?? 0,
    enrichSessionInitialPending: queue.enrichSessionInitialPending,
    items: (queue.items ?? []).map((item) => ({
      ...normalize(item),
      emailStatus: item.emailStatus ?? "eligible",
      excludeFromAutoSend: Boolean(item.excludeFromAutoSend),
    })),
    rejected: (queue.rejected ?? []).map((item) => ({
      ...normalize(item),
      emailStatus: item.emailStatus ?? "eligible",
      emailRejectReason: item.emailRejectReason,
    })),
  };
}

const OUTREACH_TIMEZONE = "Europe/Moscow";

function todayIsoMoscow(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OUTREACH_TIMEZONE,
  }).format(now);
}

function addCalendarDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addCalendarMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1 + months, d);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isoToRuDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Сколько дней после начала окна ещё включать (включительно по дате).
 * Пример: from=15.08, +15 → to=30.08.
 */
export const OUTREACH_EXPIRY_WINDOW_DAYS = 15;

/**
 * Скользящее окно по дате окончания (МСК), сдвигается на 1 день каждый день:
 * from = завтра + 1 календарный месяц,
 * to   = from + 15 дней.
 *
 * 14.07 → 15.08–30.08; 15.07 → 16.08–31.08.
 */
export function getExpiringMonthRange(now = new Date()): { from: string; to: string } {
  const tomorrowIso = addCalendarDaysIso(todayIsoMoscow(now), 1);
  const fromIso = addCalendarMonthsIso(tomorrowIso, 1);
  const toIso = addCalendarDaysIso(fromIso, OUTREACH_EXPIRY_WINDOW_DAYS);
  return { from: isoToRuDate(fromIso), to: isoToRuDate(toIso) };
}

/** Ночной cron ФСА: только правый край скользящего окна (endDate = to). */
export function getFsaDailyScanRange(now = new Date()): { from: string; to: string } {
  const { to } = getExpiringMonthRange(now);
  return { from: to, to };
}
