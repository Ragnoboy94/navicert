type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now()
): boolean {
  pruneExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) return false;

  bucket.count += 1;
  return true;
}

function pruneExpired(now: number) {
  if (buckets.size < 500) return;

  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/** Сброс для тестов */
export function resetRateLimits() {
  buckets.clear();
}
