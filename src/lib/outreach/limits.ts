export const MAX_BATCH_SEND = 150;
export const MAX_DAILY_SEND = 150;

export function clampBatchCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_BATCH_SEND);
}

export function clampDailyCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_DAILY_SEND);
}
