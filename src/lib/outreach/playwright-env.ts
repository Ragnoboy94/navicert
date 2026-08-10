import fs from "fs";
import path from "path";

/** Единый путь к браузерам Playwright — в папке проекта, не в профиле/sandbox. */
export function playwrightBrowsersPath(): string {
  const projectPath = path.join(process.cwd(), ".playwright-browsers");
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  // Cursor sandbox cache часто пустой/битый — не доверяем ему.
  if (fromEnv && /cursor-sandbox-cache/i.test(fromEnv)) {
    return projectPath;
  }
  // Если в проекте уже стоит chromium — всегда его (стабильнее для Next/admin).
  if (fs.existsSync(projectPath)) {
    return projectPath;
  }
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  return projectPath;
}

/** Выставить env до import('playwright') / launch. */
export function ensurePlaywrightBrowsersEnv(): string {
  const browsersPath = playwrightBrowsersPath();
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  return browsersPath;
}

export function playwrightEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath(),
  };
}
