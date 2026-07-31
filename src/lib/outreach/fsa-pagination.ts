import type { OutreachQueue } from "./types";

/** ФСА разрешает страницы 0..19 (не больше 20 запросов подряд с одними параметрами). */
export const FSA_API_MAX_PAGES = 20;

/**
 * Сортировки для обхода лимита 20 страниц.
 * Важно: и asc, и desc — иначе реестр «закрывает» разные хвосты одним индексом.
 * Формат как в UI/API ФСА: `field,asc` / `field,desc`.
 */
export const FSA_SORT_FIELDS = [
  "endDate,asc",
  "endDate,desc",
  "registrationDate,asc",
  "registrationDate,desc",
  "number,asc",
  "number,desc",
  "id,asc",
  "id,desc",
] as const;

export type FsaSortField = (typeof FSA_SORT_FIELDS)[number];

export type FsaLoadCursor = {
  page: number;
  sortIndex: number;
  sliceIndex: number;
};

export type RuDateRange = { from: string; to: string };

/** v2: срезы по 14 дней; v3+: плотнее (7 дней) + asc/desc сортировки. */
export const FSA_PAGINATION_VERSION = 3;

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

function daysPerSliceForVersion(paginationVersion: number): number {
  return paginationVersion >= 3 ? 7 : 14;
}

/** Делит период на подинтервалы по дате окончания (для новых «окон» пагинации). */
export function dateSlicesForLoad(
  range: RuDateRange,
  options: { mode: "reset" | "append"; paginationVersion?: number }
): RuDateRange[] {
  const version = options.paginationVersion ?? FSA_PAGINATION_VERSION;
  if (options.mode === "reset" || version >= 2) {
    return splitRangeIntoSlices(range, daysPerSliceForVersion(version));
  }
  // Legacy-очередь: страницы считались по всему периоду, не по срезам
  return [range];
}

/** Делит период на подинтервалы по дате окончания. */
export function splitRangeIntoSlices(
  range: RuDateRange,
  daysPerSlice = 7
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

export function freshFsaCursor(): FsaLoadCursor {
  return { page: 0, sortIndex: 0, sliceIndex: 0 };
}

/** Курсор за пределами текущей сетки sort×slice — пора начинать обход заново. */
export function isFsaCursorExhausted(
  cursor: FsaLoadCursor,
  sliceCount: number
): boolean {
  if (cursor.sliceIndex >= sliceCount) return true;
  if (cursor.sortIndex >= FSA_SORT_FIELDS.length) return true;
  if (
    cursor.sliceIndex >= sliceCount - 1 &&
    cursor.sortIndex >= FSA_SORT_FIELDS.length - 1 &&
    cursor.page >= FSA_API_MAX_PAGES
  ) {
    return true;
  }
  return false;
}

/** После исчерпания legacy-пагинации переходим на срезы. */
export function upgradeLegacyPagination(
  range: RuDateRange
): {
  paginationVersion: number;
  dateSlices: RuDateRange[];
  cursor: FsaLoadCursor;
} {
  return {
    paginationVersion: FSA_PAGINATION_VERSION,
    dateSlices: splitRangeIntoSlices(
      range,
      daysPerSliceForVersion(FSA_PAGINATION_VERSION)
    ),
    cursor: freshFsaCursor(),
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

/** Авто-ротация sort/slice при page≥20 и upgrade пагинации. */
export function healFsaPagination(queue: OutreachQueue): {
  queue: OutreachQueue;
  changed: boolean;
} {
  const range = queue.range;
  if (!range) return { queue, changed: false };

  const paginationVersion = Math.max(
    queue.paginationVersion ?? 1,
    FSA_PAGINATION_VERSION
  );
  let cursor = cursorFromQueue(queue);
  const sliceCount = splitRangeIntoSlices(
    range,
    daysPerSliceForVersion(paginationVersion)
  ).length;
  const before = JSON.stringify({
    paginationVersion: queue.paginationVersion ?? 1,
    apiCursor: queue.apiCursor ?? null,
    nextApiPage: queue.nextApiPage ?? null,
  });

  // Старый sortIndex мог указывать на «конец» при 4 сортировках — при 8 это ещё середина,
  // но page≥20 / выход за сетку лечим ротацией или сбросом.
  if (cursor.sortIndex >= FSA_SORT_FIELDS.length || cursor.sliceIndex >= sliceCount) {
    cursor = freshFsaCursor();
  }

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
