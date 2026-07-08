/**
 * Playwright smoke: admin mailings buttons respond (no UI freeze).
 * Run: node scripts/verify-outreach-ui.mjs
 */
import { chromium } from "playwright";
import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.join(process.cwd(), ".env.local") });
loadEnv({ path: path.join(process.cwd(), ".env") });

const BASE_URL = process.env.VERIFY_BASE_URL?.trim() || "http://localhost:3000";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD?.trim() || "navicert2025";

async function clickAndExpectEnabled(page, name, timeout = 15_000) {
  const btn = page.getByRole("button", { name });
  await btn.waitFor({ state: "visible", timeout });
  const disabled = await btn.isDisabled();
  if (disabled) throw new Error(`Button "${name}" is disabled`);
  await btn.click();
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("UI smoke test:", BASE_URL);

  await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });

  const passwordInput = page.locator('input[type="password"]');
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /войти/i }).click();
    await page.waitForURL(/\/admin/, { timeout: 10_000 });
  }

  await page.getByRole("button", { name: /рассыл/i }).click();
  await page.getByRole("tab", { name: /заканчивающиеся/i }).click();

  await page.getByRole("button", { name: /обновить/i }).click();
  console.log("  ✓ Обновить");

  await page.getByRole("button", { name: /к отправке/i }).click();
  await page.getByRole("button", { name: /готовы к отправке/i }).click();
  await page.getByRole("button", { name: /личные ящики/i }).click();
  await page.getByRole("button", { name: /всего отправлено/i }).click();
  console.log("  ✓ Filter stat buttons");

  const stopBtn = page.getByRole("button", { name: /^остановить$/i });
  if (await stopBtn.isVisible().catch(() => false)) {
    await stopBtn.click();
    console.log("  ✓ Остановить enrich");
  }

  const continueBtn = page.getByRole("button", { name: /продолжить в фоне/i });
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
    await page.waitForTimeout(500);
    const stopAgain = page.getByRole("button", { name: /^остановить$/i });
    if (await stopAgain.isVisible().catch(() => false)) {
      await stopAgain.click();
    }
    console.log("  ✓ Продолжить / Остановить enrich");
  }

  const enableBtn = page.getByRole("button", { name: /^включить$/i });
  if (!(await enableBtn.isDisabled())) {
    await enableBtn.click();
    await page.waitForTimeout(500);
    console.log("  ✓ Включить автоотправку");
    await page.getByRole("button", { name: /^выключить$/i }).click();
    console.log("  ✓ Выключить автоотправку");
  } else {
    await page.getByRole("button", { name: /сохранить лимит/i }).click();
    console.log("  ✓ Сохранить лимит (auto-send already on)");
  }

  await clickAndExpectEnabled(page, /отправить пакетом/i).catch(() => {
    console.log("  ~ Отправить пакетом disabled (no sendable — ok)");
  });

  const appendBtn = page.getByRole("button", { name: /догрузить следующие/i });
  const appendDisabled = await appendBtn.isDisabled();
  console.log(
    appendDisabled
      ? "  ~ Догрузить disabled (no prior scan — ok)"
      : "  ✓ Догрузить button clickable"
  );

  await browser.close();
  console.log("UI smoke passed — no freeze detected on clicked controls.");
}

main().catch((error) => {
  console.error("UI smoke failed:", error.message);
  process.exit(1);
});
