/**
 * Путь к persistent-профилю Playwright для checko.
 * На проде держим ВНЕ дерева приложения (/var/www/navicert-persist/…),
 * иначе Next/Turbopack на `next build` сканирует десятки тысяч файлов Chromium
 * и раздувает сборку (и RAM).
 *
 * Профиль с ручной проходкой капчи НЕ удалять — только переносить (mv).
 */
import fs from "node:fs";
import path from "node:path";

const PROD_PERSIST_ROOT = "/var/www/navicert-persist";
const PROFILE_NAME = "checko-pw-profile";

function legacyProfileDir(slot = 0): string {
  const cwd = /* turbopackIgnore: true */ process.cwd();
  return slot <= 0
    ? path.join(cwd, "data", PROFILE_NAME)
    : path.join(cwd, "data", `${PROFILE_NAME}-${slot}`);
}

function persistProfileDir(slot = 0): string {
  return slot <= 0
    ? path.join(PROD_PERSIST_ROOT, PROFILE_NAME)
    : path.join(PROD_PERSIST_ROOT, `${PROFILE_NAME}-${slot}`);
}

/** Каталог user-data Playwright (slot 0 = основной профиль с капчей). */
export function checkoProfileDir(slot = 0): string {
  const fromEnv = process.env.OUTREACH_CHECKO_PROFILE_DIR?.trim();
  if (fromEnv) {
    return slot <= 0 ? fromEnv : `${fromEnv}-${slot}`;
  }

  const persist = persistProfileDir(slot);
  const legacy = legacyProfileDir(slot);

  try {
    if (fs.existsSync(persist)) return persist;
    if (fs.existsSync(legacy)) return legacy;
    if (fs.existsSync(PROD_PERSIST_ROOT)) return persist;
  } catch {
    /* fall through */
  }

  return legacy;
}

/** Lock рядом с профилем (не внутри data/ приложения, если профиль в persist). */
export function checkoProfileLockPath(slot = 0): string {
  return `${checkoProfileDir(slot)}.lock`;
}
