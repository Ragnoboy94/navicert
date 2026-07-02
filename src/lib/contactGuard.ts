export const MIN_FORM_FILL_MS = 2500;
export const MAX_FORM_AGE_MS = 60 * 60 * 1000;

export function isHoneypotTriggered(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

export type FormTimingResult = "ok" | "too_fast" | "invalid";

export function validateFormTiming(
  formOpenedAt: unknown,
  now = Date.now()
): FormTimingResult {
  const ts = Number(formOpenedAt);
  if (!Number.isFinite(ts) || ts <= 0) return "invalid";

  const elapsed = now - ts;
  if (elapsed < MIN_FORM_FILL_MS) return "too_fast";
  if (elapsed > MAX_FORM_AGE_MS) return "invalid";
  return "ok";
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}
