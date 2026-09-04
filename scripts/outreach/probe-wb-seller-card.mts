/**
 * Живой разбор карточки продавца WB + поиск Checko по ИНН.
 * Запуск: npx tsx scripts/outreach/probe-wb-seller-card.mts
 */
import fs from "node:fs";
import path from "node:path";
import { ensurePlaywrightBrowsersEnv } from "../../src/lib/outreach/playwright-env";
import { parseCheckoCompanyPage } from "../../src/lib/outreach/checko";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveChromePath(browsersPath: string): string | undefined {
  const candidates = [
    path.join(browsersPath, "chromium-1228", "chrome-win64", "chrome.exe"),
    path.join(
      browsersPath,
      "chromium_headless_shell-1228",
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe"
    ),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

type SupplierHit = {
  id: number | string;
  name?: string;
  source: string;
};

function collectSuppliersFromJson(payload: unknown, source: string): SupplierHit[] {
  const hits: SupplierHit[] = [];
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const id = obj.supplierId ?? obj.supplier_id ?? obj.sellerId;
    const name =
      (typeof obj.supplier === "string" && obj.supplier) ||
      (typeof obj.supplierName === "string" && obj.supplierName) ||
      (typeof obj.sellerName === "string" && obj.sellerName) ||
      undefined;
    if (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) {
      hits.push({ id, name, source });
    }
    for (const v of Object.values(obj)) walk(v, depth + 1);
  };
  walk(payload, 0);
  return hits;
}

async function probeCheckoInn(inn: string) {
  const url = `https://checko.ru/search?query=${encodeURIComponent(inn)}`;
  console.log("\n===== checko INN", inn, "=====");
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" },
    redirect: "follow",
  });
  const html = await res.text();
  const finalUrl = res.url;
  console.log("status", res.status, "final", finalUrl, "len", html.length);
  const pathMatch = finalUrl.match(/checko\.ru(\/company\/[^?#]+)/i);
  const companyPath = pathMatch?.[1] || "";
  const parsed = parseCheckoCompanyPage(html, companyPath);
  console.log({
    name: parsed.shortName,
    inn: parsed.inn,
    ogrn: parsed.ogrn,
    email: parsed.email,
    emails: parsed.emails,
    url: parsed.url,
  });
}

async function main() {
  await probeCheckoInn("7707083893");

  const browsersPath = ensurePlaywrightBrowsersEnv();
  const { chromium } = await import("playwright");
  const executablePath = resolveChromePath(browsersPath);
  const profileDir = path.join(process.cwd(), "data", "wb-pw-profile-probe");
  fs.mkdirSync(profileDir, { recursive: true });
  const headed = process.env.OUTREACH_WB_HEADED === "1";

  console.log("\n===== playwright WB =====");
  console.log({ browsersPath, executablePath, headed, profileDir });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    executablePath,
    userAgent: UA,
    locale: "ru-RU",
    viewport: { width: 1366, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());
  const suppliers = new Map<string, SupplierHit>();
  const interesting: { url: string; status: number; snippet: string }[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (!/wb\.ru|wildberries|wbbasket/i.test(url)) return;
    const status = response.status();
    if (
      /seller|supplier|inn|ogrn|requisite|legal/i.test(url) ||
      /catalog\.wb\.ru|search\.wb\.ru|card\.wb\.ru/i.test(url)
    ) {
      try {
        const ct = response.headers()["content-type"] || "";
        if (ct.includes("json")) {
          const json = await response.json();
          const hits = collectSuppliersFromJson(json, url.slice(0, 120));
          for (const hit of hits) suppliers.set(String(hit.id), hit);
          if (/seller|inn|ogrn/i.test(url)) {
            interesting.push({
              url: url.slice(0, 180),
              status,
              snippet: JSON.stringify(json).slice(0, 500),
            });
          }
        }
      } catch {
        /* ignore binary */
      }
    }
  });

  await page.goto("https://www.wildberries.ru/", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await sleep(4000);
  const homeTitle = await page.title();
  const homeHtml = await page.content();
  console.log("home title", homeTitle);
  console.log("home antibot", /__wbaas|antibot|challenge/i.test(homeHtml));

  await page.goto(
    "https://www.wildberries.ru/catalog/0/search.aspx?search=%D1%81%D0%BC%D0%B0%D1%80%D1%82%D1%84%D0%BE%D0%BD",
    { waitUntil: "domcontentloaded", timeout: 90_000 }
  );
  await sleep(6000);
  await page.mouse.wheel(0, 1800);
  await sleep(2500);

  console.log("supplier ids from catalog APIs", suppliers.size);
  console.log([...suppliers.values()].slice(0, 8));

  let sellerId = [...suppliers.keys()][0];
  if (!sellerId) {
    sellerId = "432890";
    console.log("no supplier from catalog, fallback", sellerId);
  }

  const sellerUrl = `https://www.wildberries.ru/seller/${sellerId}`;
  console.log("open seller", sellerUrl);
  await page.goto(sellerUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await sleep(5000);

  const sellerHtml = await page.content();
  const sellerText = await page.locator("body").innerText().catch(() => "");
  fs.writeFileSync(
    path.join(process.env.TEMP || ".", "wb-seller-probe.html"),
    sellerHtml,
    "utf8"
  );
  console.log("seller title", await page.title());
  console.log("seller text sample", sellerText.replace(/\s+/g, " ").slice(0, 800));
  console.log(
    "seller markers",
    {
      inn: /ИНН/i.test(sellerHtml + sellerText),
      ogrn: /ОГРН/i.test(sellerHtml + sellerText),
      email: /@/.test(sellerText),
      infoBtn: /информац/i.test(sellerText),
    }
  );

  const infoBtn = page
    .locator(
      'button:has-text("Информация"), a:has-text("Информация"), [class*="seller"] >> text=/Информация|реквизит|о продавце/i'
    )
    .first();
  if (await infoBtn.count()) {
    await infoBtn.click({ timeout: 4000 }).catch(() => undefined);
    await sleep(2500);
    const after = await page.locator("body").innerText().catch(() => "");
    console.log("after info click", after.replace(/\s+/g, " ").slice(0, 900));
  }

  // Попробовать прямой JSON API в той же сессии
  const apiUrls = [
    `https://www.wildberries.ru/webapi/seller/data/short/${sellerId}`,
    `https://www.wildberries.ru/webapi/seller/data/${sellerId}`,
  ];
  for (const apiUrl of apiUrls) {
    const apiPage = await context.newPage();
    const res = await apiPage.goto(apiUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
    const body = await apiPage.locator("body").innerText().catch(() => "");
    console.log("api", apiUrl, res?.status(), body.slice(0, 400));
    await apiPage.close();
  }

  console.log("interesting seller-ish responses", interesting.slice(0, 6));
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
