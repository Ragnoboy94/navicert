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

/** Убирает из файла отправленные и устаревшие записи; история в outreach-sent.json */
export function sanitizeOutreachQueue(queue: OutreachQueue): OutreachQueue {
  const normalized = normalizeQueue(queue);
  const { items, rejected } = pruneOutreachQueue(
    normalized.items,
    normalized.rejected,
    normalized.range
  );

  const changed =
    items.length !== normalized.items.length ||
    rejected.length !== normalized.rejected.length;

  const cleaned = {
    ...normalized,
    items,
    rejected,
    enrichQueue: normalized.enrichQueue.filter((item) =>
      isEndDateInRange(item, normalized.range)
    ),
  };
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

export function getExpiringMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const fmt = (d: Date) => {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}.${d.getFullYear()}`;
  };
  return { from: fmt(from), to: fmt(to) };
}
