/**
 * Поэлементные сценарии вкладки «Новые организации».
 * Проверяет каждый контрол и взаимодействие — без технарщины в ответах.
 *
 * Запуск (dev должен быть на :3000):
 *   npm run outreach:test-checko-ui
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, type Page } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

const BASE = process.env.VERIFY_BASE_URL?.trim() || "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "navicert2025";

type Step = { name: string; ok: boolean; detail?: string };
const steps: Step[] = [];

function expect(name: string, cond: boolean, detail?: string) {
  steps.push({ name, ok: Boolean(cond), detail });
  console.log(`${cond ? "OK" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function hasTech(text: string) {
  return /OUTREACH_|PLAYWRIGHT|checko-pw-profile|npx playwright|Executable doesn't exist|cursor-sandbox/i.test(
    text
  );
}

function activePanel(page: Page) {
  return page.locator('[role="tabpanel"]:not(.hidden)').first();
}

async function openTochkaTab(page: Page) {
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  const passwordInput = page.locator('input[type="password"]');
  const mailingsNav = page.getByRole("button", { name: /^Рассылки$/i });

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await mailingsNav.isVisible().catch(() => false)) break;
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill(PASSWORD);
      await page.getByRole("button", { name: /войти/i }).click();
      await page.waitForTimeout(1500);
      if (await mailingsNav.isVisible().catch(() => false)) break;
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
  }

  await mailingsNav.waitFor({ state: "visible", timeout: 20_000 });
  await mailingsNav.click();
  await page.waitForTimeout(600);

  const tab = page.getByRole("tab", { name: /новые организации/i });
  expect("E1 вкладка «Новые организации» есть", await tab.isVisible());
  await tab.click();
  await page.getByRole("button", { name: /Загрузить с checko\.ru/i }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
}

async function main() {
  console.log(`BASE=${BASE}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);

  try {
    await openTochkaTab(page);
    const panel = activePanel(page);

    const body = await panel.innerText();
    expect("E2 нет технарщины на экране", !hasTech(body), body.slice(0, 120));

    expect(
      "E3 период регистрации виден",
      (await panel.getByText("Период регистрации").count()) > 0
    );
    expect(
      "E4 фильтр checko в описании",
      (await page.getByText(/последние 21 день/i).count()) > 0
    );

    for (const label of [
      /^к отправке/i,
      /^готовы к отправке/i,
      /^личные ящики/i,
      /^всего отправлено/i,
    ]) {
      const btn = panel.getByRole("button", { name: label }).first();
      expect(`E5 фильтр ${String(label)}`, await btn.isVisible());
      await btn.click();
      await page.waitForTimeout(150);
    }

    const loadBtn = panel.getByRole("button", { name: /Загрузить с checko\.ru/i });
    const appendBtn = panel.getByRole("button", {
      name: /Догрузить следующие|Догрузить ещё/i,
    });
    expect("E6 кнопка полной загрузки", await loadBtn.isVisible());
    expect("E7 кнопка догрузки", await appendBtn.isVisible());

    expect(
      "E8 блок автоотправки",
      await panel.getByText(/Автоотправка включена|Автоотправка выключена/i).first().isVisible()
    );
    const enable = panel.getByRole("button", { name: /Включить|Выключить/i }).first();
    expect("E9 тумблер автоотправки", await enable.isVisible());

    const sendFirst = panel.locator(
      'label:has-text("Отправить первым") input[type="number"]'
    );
    expect("E10 поле «Отправить первым»", await sendFirst.isVisible());
    await sendFirst.fill("3");
    expect("E11 можно задать число", (await sendFirst.inputValue()) === "3");

    expect(
      "E12 нет «Проверить доступ к ФСА»",
      (await panel.getByRole("button", { name: /проверить доступ к фса/i }).count()) === 0
    );
    expect(
      "E13 есть подсказка про фоновый email",
      (await panel.getByText(/email|фон|пауза/i).count()) > 0
    );

    const beforeEligible = panel.getByRole("button", { name: /^к отправке/i });
    const beforeCount = Number(
      ((await beforeEligible.innerText()).match(/(\d+)/) || [])[1] || 0
    );

    await appendBtn.click();
    await page.waitForTimeout(1500);

    let sawProgress = false;
    let sawError = false;
    let sawSummary = false;
    let finalCount = beforeCount;

    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(2000);
      const text = await panel.innerText();
      if (
        /Сейчас загружаем|Запускаем задачу|Загрузка|Догрузка|Принято:/i.test(text)
      ) {
        sawProgress = true;
      }
      if (
        /Последняя ошибка|не пускает|временно ограничил|не ответил|перегружен|не попали|капч/i.test(
          text
        )
      ) {
        sawError = true;
      }
      if (/Последний результат|Добавили/i.test(text)) {
        sawSummary = true;
      }
      expect("E14 нет технарщины во время работы", !hasTech(text));

      const eligibleText = await beforeEligible.innerText().catch(() => "");
      const n = Number((eligibleText.match(/(\d+)/) || [])[1] || 0);
      if (n) finalCount = n;

      const stillBusy =
        /Сейчас загружаем|Запускаем задачу|Загрузка…|Догрузка…/i.test(text);
      if (!stillBusy && i >= 2) break;
    }

    const endedText = await panel.innerText();
    const stuckFakeBusy =
      /срочных 0,\s*фоновых 0\s*·\s*сейчас идёт догрузка/i.test(endedText) ||
      (/Очередь задач пуста/i.test(endedText) &&
        /Сейчас загружаем/i.test(endedText));

    expect("E15 был прогресс или быстрый ответ", sawProgress || sawError || sawSummary);
    expect(
      "E16 нет фейка «срочных 0 · сейчас идёт догрузка»",
      !stuckFakeBusy,
      endedText.match(/(В очереди задач|Сейчас загружаем|Очередь задач пуста)[^\n]*/)?.[0]
    );
    expect(
      "E17 итог: записи в очереди ИЛИ понятная ошибка",
      finalCount > beforeCount || sawError || sawSummary,
      `before=${beforeCount} after=${finalCount} err=${sawError} sum=${sawSummary}`
    );

    const refreshBtn = panel.getByRole("button", { name: /^Обновить$/i }).first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(800);
      expect("E18 Обновить без технарщины", !hasTech(await panel.innerText()));
    } else {
      expect("E18 кнопка Обновить (опционально)", true, "нет на экране — ок");
    }
  } finally {
    await browser.close();
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} passed`);
  if (failed.length) {
    console.error(failed.map((f) => `- ${f.name}: ${f.detail || ""}`).join("\n"));
    process.exit(1);
  }
  console.log("all checko UI element scenarios ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
