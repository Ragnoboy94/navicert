import { readSentRecordsByCategory } from "./mailer";
import { hasKnownOkved, isAllowedNewRegOkved } from "./okved";
import type {
  FsaDeclaration,
  OutreachCategory,
  OutreachQueueItem,
} from "./types";
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
  declaration: Pick<FsaDeclaration, "endDate" | "registrationDate">,
  range: { from: string; to: string }
): boolean {
  // Для новых орг. в endDate кладём дату регистрации; если пусто — берём registrationDate.
  const endDate =
    parseAnyDate(declaration.endDate) ||
    parseAnyDate(declaration.registrationDate || "");
  if (!endDate) return false;

  const from = new Date(`${ruDateToIso(range.from)}T00:00:00`);
  const to = new Date(`${ruDateToIso(range.to)}T23:59:59`);
  return endDate >= from && endDate <= to;
}

/** List-only checko: даты часто нет до карточки — не выкидываем из enrichQueue. */
export function isEnrichItemInRange(
  declaration: Pick<FsaDeclaration, "endDate" | "registrationDate"> & {
    productGroup?: string;
    productName?: string;
  },
  range: { from: string; to: string },
  category: OutreachCategory = "expiring"
): boolean {
  if (category === "new_registrations") {
    // Уже знаем ОКВЭД и он вне allowlist — не тратим карточку.
    if (hasKnownOkved(declaration) && !isAllowedNewRegOkved(declaration)) {
      return false;
    }
    const hasDate =
      Boolean(parseAnyDate(declaration.endDate)) ||
      Boolean(parseAnyDate(declaration.registrationDate || ""));
    if (!hasDate) return true;
  }
  return isEndDateInRange(declaration, range);
}

function sortByEndDate(items: OutreachQueueItem[]): OutreachQueueItem[] {
  return [...items].sort((a, b) => {
    const da = parseAnyDate(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseAnyDate(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });
}

function inDateWindow(
  item: OutreachQueueItem,
  range: { from: string; to: string },
  category: OutreachCategory
): boolean {
  if (category === "new_registrations") {
    const hasDate =
      Boolean(parseAnyDate(item.endDate)) ||
      Boolean(parseAnyDate(item.registrationDate || ""));
    if (!hasDate) return true;
  }
  return isEndDateInRange(item, range);
}

/** Убираем из очереди отправленные, вне периода; для checko — фильтр ОКВЭД. */
export function pruneOutreachQueue(
  items: OutreachQueueItem[],
  rejected: OutreachQueueItem[],
  range: { from: string; to: string },
  category: OutreachCategory = "expiring"
): { items: OutreachQueueItem[]; rejected: OutreachQueueItem[] } {
  const sentIds = new Set(
    readSentRecordsByCategory(category).map((record) => record.declarationId)
  );

  if (category !== "new_registrations") {
    const keep = (item: OutreachQueueItem) => {
      if (sentIds.has(item.id)) return false;
      return inDateWindow(item, range, category);
    };
    return {
      items: sortByEndDate(items.filter(keep)),
      rejected: sortByEndDate(rejected.filter(keep)),
    };
  }

  const nextItems: OutreachQueueItem[] = [];
  const nextRejected: OutreachQueueItem[] = [];
  const seen = new Set<number>();

  const pushRejected = (item: OutreachQueueItem, okvedReject = false) => {
    if (seen.has(item.id) || sentIds.has(item.id)) return;
    if (!inDateWindow(item, range, category)) return;
    seen.add(item.id);
    nextRejected.push(
      okvedReject
        ? {
            ...item,
            emailStatus: "rejected",
            emailRejectReason: "okved_not_allowed",
          }
        : item
    );
  };

  for (const item of rejected) {
    if (sentIds.has(item.id)) continue;
    if (item.emailRejectReason === "okved_not_allowed") {
      pushRejected(item);
      continue;
    }
    if (hasKnownOkved(item) && !isAllowedNewRegOkved(item)) {
      pushRejected(item, true);
      continue;
    }
    // Без кода в rejected не держим (ждём enrich или отбрасываем мусор).
    if (!hasKnownOkved(item)) continue;
    if (!inDateWindow(item, range, category)) continue;
    seen.add(item.id);
    nextRejected.push(item);
  }

  for (const item of items) {
    if (sentIds.has(item.id) || seen.has(item.id)) continue;
    if (hasKnownOkved(item) && !isAllowedNewRegOkved(item)) {
      pushRejected(item, true);
      continue;
    }
    if (!hasKnownOkved(item)) continue;
    if (!inDateWindow(item, range, category)) continue;
    seen.add(item.id);
    nextItems.push(item);
  }

  return {
    items: sortByEndDate(nextItems),
    // no_email / okved_not_allowed остаются в файле (append не тащит снова),
    // в UI «Личные ящики» их режет isDisplayRejectedItem.
    rejected: sortByEndDate(nextRejected),
  };
}
