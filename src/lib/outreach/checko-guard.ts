/**
 * Cooldown после капчи/лимита checko — не долбим сайт повторными scan/enrich.
 */
import fs from "node:fs";
import path from "node:path";

const BLOCK_FILE = path.join(process.cwd(), "data", "checko-access-block.json");

/** По умолчанию 25 мин — после SmartCaptcha повтор раньше почти бесполезен. */
export function getCheckoCooldownMs(): number {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_CHECKO_COOLDOWN_MS || 25 * 60_000), 5 * 60_000),
    3 * 60 * 60_000
  );
}

type BlockState = {
  blockedUntil: string;
  reason?: string;
  at?: string;
};

function readBlock(): BlockState | null {
  try {
    if (!fs.existsSync(BLOCK_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(BLOCK_FILE, "utf8")) as BlockState;
    if (!raw?.blockedUntil) return null;
    return raw;
  } catch {
    return null;
  }
}

export function getCheckoBlockRemainingMs(now = Date.now()): number {
  const block = readBlock();
  if (!block) return 0;
  const until = Date.parse(block.blockedUntil);
  if (!Number.isFinite(until)) return 0;
  return Math.max(until - now, 0);
}

export function isCheckoBlocked(now = Date.now()): boolean {
  return getCheckoBlockRemainingMs(now) > 0;
}

export function getCheckoBlockReason(): string | null {
  if (!isCheckoBlocked()) return null;
  const block = readBlock();
  const mins = Math.ceil(getCheckoBlockRemainingMs() / 60_000);
  const reason = block?.reason?.trim() || "защита от ботов";
  return `checko временно недоступен (${reason}). Повтор через ~${mins} мин.`;
}

export function markCheckoBlocked(reason = "капча/лимит"): void {
  const dir = path.dirname(BLOCK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const at = new Date().toISOString();
  const blockedUntil = new Date(Date.now() + getCheckoCooldownMs()).toISOString();
  const state: BlockState = { blockedUntil, reason, at };
  fs.writeFileSync(BLOCK_FILE, JSON.stringify(state), "utf8");
  if (process.env.OUTREACH_DEBUG === "1" || process.env.NODE_ENV !== "production") {
    console.warn(`[checko-guard] blocked until ${blockedUntil} (${reason})`);
  }
}

export function clearCheckoBlock(): void {
  try {
    if (fs.existsSync(BLOCK_FILE)) fs.unlinkSync(BLOCK_FILE);
  } catch {
    /* ignore */
  }
}

/** Простая файловая блокировка профиля — scan и enrich не должны открывать Chrome одновременно. */
const PROFILE_LOCK = path.join(process.cwd(), "data", "checko-pw-profile.lock");

export async function withCheckoProfileLock<T>(
  fn: () => Promise<T>,
  options?: { waitMs?: number; label?: string }
): Promise<T> {
  const waitMs = options?.waitMs ?? 120_000;
  const label = options?.label || "checko";
  const started = Date.now();
  const dir = path.dirname(PROFILE_LOCK);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  while (true) {
    try {
      const fd = fs.openSync(PROFILE_LOCK, "wx");
      fs.writeFileSync(fd, `${process.pid}\n${label}\n${new Date().toISOString()}\n`);
      fs.closeSync(fd);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      // Стейл-лок: старше 15 мин — снимаем
      try {
        const st = fs.statSync(PROFILE_LOCK);
        if (Date.now() - st.mtimeMs > 15 * 60_000) {
          fs.unlinkSync(PROFILE_LOCK);
          continue;
        }
      } catch {
        /* retry */
      }
      if (Date.now() - started > waitMs) {
        throw new Error(
          `CHECKO_PROFILE_BUSY: профиль checko занят другой задачей (${label})`
        );
      }
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.unlinkSync(PROFILE_LOCK);
    } catch {
      /* ignore */
    }
  }
}
