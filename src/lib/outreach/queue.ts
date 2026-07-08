import fs from "fs";
import path from "path";
import { normalizeDeclaration } from "./fsa";
import { pruneOutreachQueue, isEndDateInRange } from "./queue-cleanup";
import type { OutreachQueue } from "./types";

const queuePath = path.join(process.cwd(), "data", "outreach-queue.json");

export function readOutreachQueue(): OutreachQueue | null {
  if (!fs.existsSync(queuePath)) return null;
  const raw = JSON.parse(fs.readFileSync(queuePath, "utf-8")) as OutreachQueue;
  return sanitizeOutreachQueue(normalizeQueue(raw));
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

function normalizeQueue(queue: OutreachQueue): OutreachQueue {
  return {
    ...queue,
    nextApiPage: queue.nextApiPage ?? 0,
    pageSize: queue.pageSize ?? 100,
    hasMore: queue.hasMore ?? false,
    enrichQueue: (queue.enrichQueue ?? []).map(normalizeDeclaration),
    enrichPaused: Boolean(queue.enrichPaused),
    items: (queue.items ?? []).map((item) => ({
      ...normalizeDeclaration(item),
      emailStatus: item.emailStatus ?? "eligible",
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
