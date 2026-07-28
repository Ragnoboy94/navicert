import { readSentRecordsByCategory } from "./mailer";
import type { FsaDeclaration, OutreachCategory, OutreachQueueItem } from "./types";
import { ruDateToIso } from "./bulk-load";

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

export function isEndDateInRange(
  declaration: Pick<FsaDeclaration, "endDate">,
  range: { from: string; to: string }
): boolean {
  const endDate = parseAnyDate(declaration.endDate);
  if (!endDate) return false;

  const from = new Date(`${ruDateToIso(range.from)}T00:00:00`);
  const to = new Date(`${ruDateToIso(range.to)}T23:59:59`);
  return endDate >= from && endDate <= to;
}

function sortByEndDate(items: OutreachQueueItem[]): OutreachQueueItem[] {
  return [...items].sort((a, b) => {
    const da = parseAnyDate(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseAnyDate(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });
}

/** Убираем из очереди отправленные, вне периода и без email — история остаётся в outreach-sent.json */
export function pruneOutreachQueue(
  items: OutreachQueueItem[],
  rejected: OutreachQueueItem[],
  range: { from: string; to: string },
  category: OutreachCategory = "expiring"
): { items: OutreachQueueItem[]; rejected: OutreachQueueItem[] } {
  const sentIds = new Set(
    readSentRecordsByCategory(category).map((record) => record.declarationId)
  );

  const keep = (item: OutreachQueueItem) => {
    if (sentIds.has(item.id)) return false;
    if (!isEndDateInRange(item, range)) return false;
    if (item.emailStatus === "no_email") return false;
    return true;
  };

  return {
    items: sortByEndDate(items.filter(keep)),
    rejected: sortByEndDate(rejected.filter(keep)),
  };
}
