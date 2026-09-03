/**
 * Лёгкое окно дат для новых организаций — без сетевых импортов.
 * Нужно админскому GET /api/admin/outreach, чтобы пустая вкладка оставалась быстрой.
 */

export const NEW_REG_WINDOW_DAYS = 21;
/** @deprecated use NEW_REG_WINDOW_DAYS */
export const CHECKO_REG_WINDOW_DAYS = NEW_REG_WINDOW_DAYS;

function todayIsoMoscow(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

function addCalendarDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isoToRuDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

/** Последние 21 день: сегодня−21 … сегодня (МСК). */
export function getNewRegistrationsRange(now = new Date()): {
  from: string;
  to: string;
} {
  const toIso = todayIsoMoscow(now);
  const fromIso = addCalendarDaysIso(toIso, -NEW_REG_WINDOW_DAYS);
  return { from: isoToRuDate(fromIso), to: isoToRuDate(toIso) };
}

/** Ночной cron: сегодня−2 … сегодня (МСК) — текущий день и два предыдущих. */
export function getCheckoDailyScanRange(now = new Date()): {
  from: string;
  to: string;
} {
  const toIso = todayIsoMoscow(now);
  const fromIso = addCalendarDaysIso(toIso, -2);
  return { from: isoToRuDate(fromIso), to: isoToRuDate(toIso) };
}

export function ruDateToIso(ru: string): string {
  const m = ru.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return ru;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
