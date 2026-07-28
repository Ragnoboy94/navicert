/**
 * UI + FSA: логин в админку, загрузка деклараций и сертификатов (без отправки писем).
 *
 * Запуск:
 *   $env:PLAYWRIGHT_BROWSERS_PATH=(Resolve-Path .playwright-browsers).Path
 *   npx tsx scripts/outreach/test-fsa-scan-ui.mts
 */
import { chromium, type Page, type Response } from "playwright";
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ||
  path.join(root, ".playwright-browsers");

loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

const BASE_URL = process.env.VERIFY_BASE_URL?.trim() || "http://localhost:3000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim();
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD не задан в .env.local");
  process.exit(1);
}

type ScanResult = {
  category: string;
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
};

async function login(page: Page) {
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
  // Next.js HMR держит сеть — не ждём networkidle
  const passwordInput = page.locator('input[type="password"]');
  const mailingsNav = page.getByRole("button", { name: /^Рассылки$/i });

  for (let i = 0; i < 40; i += 1) {
    if (await mailingsNav.isVisible().catch(() => false)) break;
    if (await passwordInput.isVisible().catch(() => false)) break;
    await page.waitForTimeout(500);
  }

  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /^Войти$/i }).click();
    await mailingsNav.waitFor({ state: "visible", timeout: 30_000 });
  } else if (!(await mailingsNav.isVisible().catch(() => false))) {
    throw new Error("Не удалось открыть админку (ни форма входа, ни меню)");
  }
}

async function openMailings(page: Page) {
  await page.getByRole("button", { name: /^Рассылки$/i }).click();
  await page.getByRole("tablist", { name: /виды рассылок/i }).waitFor({
    timeout: 15_000,
  });
}

async function selectTab(page: Page, name: RegExp) {
  await page.getByRole("tab", { name }).click();
  await page.waitForTimeout(800);
}

async function runAppendScan(page: Page, category: string): Promise<ScanResult> {
  const scanUrl = `/api/admin/outreach/scan?category=${encodeURIComponent(category)}`;

  const waitScan = page.waitForResponse(
    (res: Response) =>
      res.url().includes("/api/admin/outreach/scan") &&
      res.url().includes(`category=${encodeURIComponent(category)}`) &&
      res.request().method() === "POST",
    { timeout: 280_000 }
  );

  const appendBtn = page.getByRole("button", {
    name: /Догрузить следующие 100/i,
  });
  await appendBtn.waitFor({ state: "visible", timeout: 15_000 });
  if (await appendBtn.isDisabled()) {
    throw new Error(`Кнопка «Догрузить следующие 100» disabled (${category})`);
  }
  await appendBtn.click();

  const response = await waitScan;
  const status = response.status();
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  return {
    category,
    ok: response.ok(),
    status,
    body,
  };
}

function summarize(result: ScanResult) {
  const b = result.body;
  return {
    category: result.category,
    http: result.status,
    ok: result.ok,
    error: b.error ?? null,
    loadedFromApi: b.loadedFromApi ?? null,
    addedNew: b.addedNew ?? null,
    eligible: b.eligible ?? null,
    enrichPending: b.enrichPending ?? null,
    hasMore: b.hasMore ?? null,
    range: b.range ?? null,
  };
}

async function main() {
  console.log("FSA UI scan test:", BASE_URL);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);

  try {
    await login(page);
    await openMailings(page);

    await selectTab(page, /Заканчивающиеся декларации/i);
    const decls = await runAppendScan(page, "expiring");
    console.log("declarations", JSON.stringify(summarize(decls), null, 2));

    await selectTab(page, /Заканчивающиеся сертификаты/i);
    const certs = await runAppendScan(page, "expiring_certificates");
    console.log("certificates", JSON.stringify(summarize(certs), null, 2));

    const failed = [decls, certs].filter((r) => !r.ok);
    if (failed.length) {
      console.error(
        "FAILED:",
        failed.map((f) => ({
          category: f.category,
          status: f.status,
          error: f.body.error,
        }))
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          declarationsLoaded: Number(decls.body.loadedFromApi ?? 0),
          certificatesLoaded: Number(certs.body.loadedFromApi ?? 0),
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
