import type { OutreachQueue } from "./types";
import {
  splitRangeIntoSlices,
  type RuDateRange,
} from "./fsa-pagination";

/** v4: только default sort — order=reg_date на checko зависает, остальные дублируют порядок. */
export const CHECKO_PAGINATION_VERSION = 4;

export const CHECKO_SLICE_DAYS = 3;

/** На checko.ru пагинация только ?page=N; order=reg_date ломает загрузку. */
export const CHECKO_SORT_QUERIES = [""] as const;

export type CheckoLoadCursor = {
  /** Следующая страница списка (1-based, как на checko). */
  page: number;
  sortIndex: number;
  sliceIndex: number;
};

export function checkoDateSlices(
  range: RuDateRange,
  paginationVersion = CHECKO_PAGINATION_VERSION
): RuDateRange[] {
  if (paginationVersion >= 3) {
    return splitRangeIntoSlices(range, CHECKO_SLICE_DAYS);
  }
  return [range];
}

export function cursorFromCheckoQueue(
  queue: OutreachQueue | null
): CheckoLoadCursor {
  if (queue?.apiCursor) {
    return {
      page: Math.max(queue.apiCursor.page ?? 1, 1),
      sortIndex: Math.max(queue.apiCursor.sortIndex ?? 0, 0),
      sliceIndex: Math.max(queue.apiCursor.sliceIndex ?? 0, 0),
    };
  }
  return freshCheckoCursor();
}

export function freshCheckoCursor(): CheckoLoadCursor {
  return { page: 1, sortIndex: 0, sliceIndex: 0 };
}

export function getCheckoSortQuery(sortIndex: number): string {
  const idx = Math.max(0, Math.min(sortIndex, CHECKO_SORT_QUERIES.length - 1));
  return CHECKO_SORT_QUERIES[idx] ?? "";
}

export function isCheckoCursorExhausted(
  cursor: CheckoLoadCursor,
  sliceCount: number
): boolean {
  if (sliceCount <= 0) return true;
  if (cursor.sliceIndex >= sliceCount) return true;
  if (cursor.sortIndex >= CHECKO_SORT_QUERIES.length) return true;
  return (
    cursor.sliceIndex >= sliceCount - 1 &&
    cursor.sortIndex >= CHECKO_SORT_QUERIES.length - 1
  );
}

export function rotateCheckoCursor(
  cursor: CheckoLoadCursor,
  sliceCount: number
): { cursor: CheckoLoadCursor; exhausted: boolean } {
  if (cursor.sortIndex + 1 < CHECKO_SORT_QUERIES.length) {
    return {
      cursor: { ...cursor, sortIndex: cursor.sortIndex + 1, page: 1 },
      exhausted: false,
    };
  }
  if (cursor.sliceIndex + 1 < sliceCount) {
    return {
      cursor: { page: 1, sortIndex: 0, sliceIndex: cursor.sliceIndex + 1 },
      exhausted: false,
    };
  }
  return { cursor, exhausted: true };
}

export function describeCheckoCursor(
  cursor: CheckoLoadCursor,
  slices: RuDateRange[]
): string {
  const slice = slices[cursor.sliceIndex] ?? slices[0];
  const sort = getCheckoSortQuery(cursor.sortIndex) || "default";
  return `checko ${slice?.from ?? "?"}–${slice?.to ?? "?"} sort=${sort} page=${cursor.page}`;
}

export function buildCheckoAdvancedListUrl(
  pageNum: number,
  sortQuery?: string
): string {
  const params = new URLSearchParams();
  if (pageNum > 1) params.set("page", String(pageNum));
  const query = sortQuery?.trim();
  if (query) {
    for (const part of query.split("&")) {
      const [key, value = ""] = part.split("=");
      if (key) params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `/search/advanced?${qs}` : "/search/advanced";
}
