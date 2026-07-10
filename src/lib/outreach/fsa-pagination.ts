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
    msg.includes("загрузке страниц: 20")
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

export function describeFsaCursor(
  cursor: FsaLoadCursor,
  slices: RuDateRange[]
): string {
  const slice = slices[cursor.sliceIndex] ?? slices[0];
  const sort = getSortField(cursor);
  return `период ${slice.from}–${slice.to}, сортировка ${sort}, стр. ${cursor.page + 1}`;
}
