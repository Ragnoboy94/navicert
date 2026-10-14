/** Проверка админ-cookie без next/headers — для WebSocket upgrade. */

export const ADMIN_COOKIE_NAME = "navicert_admin";

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "navicert2025";
}

export function isAdminCookieHeader(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== ADMIN_COOKIE_NAME) continue;
    try {
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      return value === getAdminPassword();
    } catch {
      return false;
    }
  }
  return false;
}
