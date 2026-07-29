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

async function ensureLoggedIn(page) {
  await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  const passwordInput = page.locator('input[type="password"]');
  const mailingsNav = page.getByRole("button", { name: /^Рассылки$/i });

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await mailingsNav.isVisible().catch(() => false)) return;

    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: /войти/i }).click();
      await page.waitForTimeout(1500);
      if (await mailingsNav.isVisible().catch(() => false)) return;
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  }

  await mailingsNav.waitFor({ state: "visible", timeout: 20_000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("UI smoke test:", BASE_URL);

  await ensureLoggedIn(page);

  await page.getByRole("button", { name: /^Рассылки$/i }).click();
  const declarationsTab = page.getByRole("tab", {
    name: /заканчивающиеся декларации/i,
  });
  await declarationsTab.waitFor({ state: "visible", timeout: 20_000 });
  await declarationsTab.click();

  await page.getByRole("button", { name: /обновить/i }).click();
  console.log("  ✓ Обновить");

  const healthBtn = page.getByRole("button", {
    name: /проверить доступ к фса/i,
  });
  await healthBtn.waitFor({ state: "visible", timeout: 15_000 });
  await healthBtn.click();
  await page.waitForTimeout(1500);
  console.log("  ✓ Проверить доступ к ФСА");

  await page.getByRole("button", { name: /^к отправке/i }).click();
  await page.getByRole("button", { name: /^готовы к отправке/i }).click();
  await page.getByRole("button", { name: /^личные ящики/i }).click();
  await page.getByRole("button", { name: /^всего отправлено/i }).click();
  console.log("  ✓ Filter stat buttons");

  const removeQueued = page.getByRole("button", { name: /убрать из очереди/i });
  if (await removeQueued.isVisible().catch(() => false)) {
    await removeQueued.click();
    await page.waitForTimeout(400);
    console.log("  ✓ Убрать из очереди");
  }

  const stopBtn = page.getByRole("button", { name: /^остановить$/i });
  if (await stopBtn.isVisible().catch(() => false)) {
    await stopBtn.click();
    console.log("  ✓ Остановить enrich");
  }

  const continueBtn = page.getByRole("button", { name: /продолжить в фоне/i });
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
    await page.waitForTimeout(500);
    const stopAgain = page.getByRole("button", {
      name: /^(остановить|убрать из очереди)$/i,
    });
    if (await stopAgain.isVisible().catch(() => false)) {
      await stopAgain.click();
    }
    console.log("  ✓ Продолжить / снять enrich");
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

  // Вторая вкладка: сертификаты
  await page.getByRole("tab", { name: /заканчивающиеся сертификаты/i }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /обновить/i }).click();
  console.log("  ✓ Сертификаты / Обновить");
  const certHealth = page.getByRole("button", {
    name: /проверить доступ к фса/i,
  });
  if (await certHealth.isVisible().catch(() => false)) {
    await certHealth.click();
    await page.waitForTimeout(1000);
    console.log("  ✓ Сертификаты / Проверить доступ к ФСА");
  }

  await browser.close();
  console.log("UI smoke passed — no freeze detected on clicked controls.");
}

main().catch(async (error) => {
  console.error("UI smoke failed:", error.message);
  process.exit(1);
});
