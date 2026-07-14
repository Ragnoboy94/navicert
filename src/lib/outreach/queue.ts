import fs from "fs";
import path from "path";
import { normalizeDeclaration } from "./fsa";
import { pruneOutreachQueue, isEndDateInRange } from "./queue-cleanup";
import { healFsaPagination } from "./fsa-pagination";
import type { OutreachQueue } from "./types";

const queuePath = path.join(process.cwd(), "data", "outreach-queue.json");

export function readOutreachQueue(): OutreachQueue | null {
  if (!fs.existsSync(queuePath)) return null;
  const raw = JSON.parse(fs.readFileSync(queuePath, "utf-8")) as OutreachQueue;
  const { queue: healed, changed } = healFsaPagination(raw);
  if (changed) writeOutreachQueue(healed);
  return sanitizeOutreachQueue(normalizeQueue(healed));
}

/** Убирает отправленные и то, что вне актуального окна.
 *  При сдвиге формулы периода обновляем range и вычищаем старьё вне окна,
 *  но не делаем полный reset очереди с нуля через API. */
export function sanitizeOutreachQueue(queue: OutreachQueue): OutreachQueue {
  const normalized = normalizeQueue(queue);
  const current = getExpiringMonthRange();
  const rangeChanged =
    !normalized.range ||
    normalized.range.from !== current.from ||
    normalized.range.to !== current.to;
  const range = current;

  const { items, rejected } = pruneOutreachQueue(
    normalized.items,
    normalized.rejected,
    range
  );

  const enrichQueue = normalized.enrichQueue.filter((item) =>
    isEndDateInRange(item, range)
  );

  const cleaned: OutreachQueue = {
    ...normalized,
    range,
    items,
    rejected,
    enrichQueue,
    ...(rangeChanged
      ? {
          apiCursor: { page: 0, sortIndex: 0, sliceIndex: 0 },
          nextApiPage: 0,
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
  const dir = path.dirname(queuePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify(normalizeQueue(queue), null, 2) + "\n");
}

export function setExcludeFromAutoSend(
  declarationId: number,
  exclude: boolean
): OutreachQueue | null {
  const queue = readOutreachQueue();
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
  const { queue: healed } = healFsaPagination(migrated);
  const apiCursor = healed.apiCursor ?? {
    page: healed.nextApiPage ?? 0,
    sortIndex: 0,
    sliceIndex: 0,
  };
  return {
    ...healed,
    nextApiPage: apiCursor.page,
    apiCursor,
    paginationVersion: Math.max(healed.paginationVersion ?? 1, 2),
    pageSize: queue.pageSize ?? 100,
    hasMore: queue.hasMore ?? false,
    enrichQueue: (queue.enrichQueue ?? []).map(normalizeDeclaration),
    enrichPaused: Boolean(queue.enrichPaused),
    enrichProcessedTotal: queue.enrichProcessedTotal ?? 0,
    enrichEmailsFoundTotal: queue.enrichEmailsFoundTotal ?? 0,
    enrichSessionInitialPending: queue.enrichSessionInitialPending,
    items: (queue.items ?? []).map((item) => ({
      ...normalizeDeclaration(item),
      emailStatus: item.emailStatus ?? "eligible",
      excludeFromAutoSend: Boolean(item.excludeFromAutoSend),
    })),
    rejected: (queue.rejected ?? []).map((item) => ({
      ...normalizeDeclaration(item),
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
