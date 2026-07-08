import path from "path";

/** Единый путь к браузерам Playwright — в папке проекта, не в профиле пользователя. */
export function playwrightBrowsersPath(): string {
  return (
    process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ||
    path.join(process.cwd(), ".playwright-browsers")
  );
}

export function playwrightEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath(),
  };
}
