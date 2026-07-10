import type { OutreachQueue } from "./types";

/** ФСА разрешает страницы 0..19 (не больше 20 запросов подряд с одними параметрами). */
export const FSA_API_MAX_PAGES = 20;

/** Поля сортировки для обхода лимита страниц (новый «срез» реестра). */
export const FSA_SORT_FIELDS = [
  "endDate",
  "registrationDate",
  "number",
  "id",
] as const;

export type FsaSortField = (typeof FSA_SORT_FIELDS)[number];

export type FsaLoadCursor = {
  page: number;
  sortIndex: number;
  sliceIndex: number;
};

export type RuDateRange = { from: string; to: string };

export function ruDateToIso(ru: string): string {
  const [day, month, year] = ru.split(".");
  return `${year}-${month}-${day}`;
}

export function isoToRu(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

function parseRuDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Делит период на подинтервалы по дате окончания (для новых «окон» пагинации). */
export function dateSlicesForLoad(
  range: RuDateRange,
  options: { mode: "reset" | "append"; paginationVersion?: number }
): RuDateRange[] {
  if (options.mode === "reset" || (options.paginationVersion ?? 1) >= 2) {
    return splitRangeIntoSlices(range);
  }
  // Legacy-очередь: страницы считались по всему периоду, не по 14-дневным срезам
  return [range];
}

/** Делит период на подинтервалы по дате окончания (для новых «окон» пагинации). */
export function splitRangeIntoSlices(
  range: RuDateRange,
  daysPerSlice = 14
): RuDateRange[] {
  const start = parseRuDate(range.from);
  const end = parseRuDate(range.to);
  if (!start || !end || start > end) return [range];

  const slices: RuDateRange[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const sliceEnd = new Date(cursor);
    sliceEnd.setDate(sliceEnd.getDate() + daysPerSlice - 1);
    const capped = sliceEnd > end ? end : sliceEnd;
    slices.push({
      from: isoToRu(formatIsoDate(cursor)),
      to: isoToRu(formatIsoDate(capped)),
    });
    cursor.setDate(cursor.getDate() + daysPerSlice);
  }
  return slices.length > 0 ? slices : [range];
}

function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function cursorFromQueue(queue: OutreachQueue | null): FsaLoadCursor {
  if (queue?.apiCursor) return { ...queue.apiCursor };
  return {
    page: queue?.nextApiPage ?? 0,
    sortIndex: 0,
    sliceIndex: 0,
  };
}

/** После исчерпания legacy-пагинации (один период, 4 сортировки) переходим на срезы по 14 дней. */
export function upgradeLegacyPagination(
  range: RuDateRange
): { paginationVersion: 2; dateSlices: RuDateRange[]; cursor: FsaLoadCursor } {
  return {
    paginationVersion: 2,
    dateSlices: splitRangeIntoSlices(range),
    cursor: { page: 0, sortIndex: 0, sliceIndex: 0 },
  };
}

export function getSortField(cursor: FsaLoadCursor): FsaSortField {
  const idx = Math.min(
    Math.max(cursor.sortIndex, 0),
    FSA_SORT_FIELDS.length - 1
  );
  return FSA_SORT_FIELDS[idx];
}

export function isFsaPageLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("ограничение по загрузке страниц") ||
    msg.includes("загрузке страниц: 20") ||
    msg.includes("загрузке страниц") ||
    /\bpage\b.*\b20\b/i.test(msg)
  );
}

/** Следующий cursor: другая сортировка → другой подпериод → конец. */
export function rotateFsaCursor(
  cursor: FsaLoadCursor,
  sliceCount: number
): { cursor: FsaLoadCursor; exhausted: boolean } {
  if (cursor.sortIndex + 1 < FSA_SORT_FIELDS.length) {
    return {
      cursor: { ...cursor, sortIndex: cursor.sortIndex + 1, page: 0 },
      exhausted: false,
    };
  }
  if (cursor.sliceIndex + 1 < sliceCount) {
    return {
      cursor: { page: 0, sortIndex: 0, sliceIndex: cursor.sliceIndex + 1 },
      exhausted: false,
    };
  }
  return { cursor, exhausted: true };
}

export function cursorNeedsRotation(cursor: FsaLoadCursor): boolean {
  return cursor.page >= FSA_API_MAX_PAGES;
}

/** Авто-ротация sort/slice при page≥20 и upgrade на pagination v2 (без ручного сброса). */
export function healFsaPagination(queue: OutreachQueue): {
  queue: OutreachQueue;
  changed: boolean;
} {
  const range = queue.range;
  if (!range) return { queue, changed: false };

  const paginationVersion = Math.max(queue.paginationVersion ?? 1, 2);
  let cursor = cursorFromQueue(queue);
  const sliceCount = splitRangeIntoSlices(range).length;
  const before = JSON.stringify({
    paginationVersion: queue.paginationVersion ?? 1,
    apiCursor: queue.apiCursor ?? null,
    nextApiPage: queue.nextApiPage ?? null,
  });

  let guard = 0;
  const maxSteps = FSA_SORT_FIELDS.length * Math.max(sliceCount, 1);
  while (cursorNeedsRotation(cursor) && guard < maxSteps) {
    guard += 1;
    const rotated = rotateFsaCursor(cursor, sliceCount);
    if (rotated.exhausted) break;
    cursor = rotated.cursor;
  }

  const next: OutreachQueue = {
    ...queue,
    paginationVersion,
    apiCursor: cursor,
    nextApiPage: cursor.page,
    hasMore: queue.hasMore !== false,
  };
  const after = JSON.stringify({
    paginationVersion: next.paginationVersion,
    apiCursor: next.apiCursor,
    nextApiPage: next.nextApiPage,
  });
  return { queue: next, changed: before !== after };
}

export function describeFsaCursor(
  cursor: FsaLoadCursor,
  slices: RuDateRange[]
): string {
  const slice = slices[cursor.sliceIndex] ?? slices[0];
  const sort = getSortField(cursor);
  return `период ${slice.from}–${slice.to}, сортировка ${sort}, стр. ${cursor.page + 1}`;
}
