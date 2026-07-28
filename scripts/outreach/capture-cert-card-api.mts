/**
 * Playwright: открыть карточку сертификата и перехватить API detail.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightLaunchOptions } from "./fsa-proxy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ||
  path.join(root, ".playwright-browsers");

const id = Number(process.argv[2] || 3602563);

async function main() {
  const browser = await chromium.launch(playwrightLaunchOptions());
  const hits: Array<{ method: string; url: string; status?: number }> = [];
  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/v1/") && (url.includes("cert") || url.includes(String(id)))) {
        hits.push({ method: req.method(), url });
      }
    });
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/api/v1/") && (url.includes("cert") || url.includes(String(id)))) {
        const hit = [...hits].reverse().find((h) => h.url === url && h.status == null);
        if (hit) hit.status = res.status();
        else hits.push({ method: res.request().method(), url, status: res.status() });
      }
    });

    const urls = [
      `https://pub.fsa.gov.ru/rss/certificate/view/${id}/applicant`,
      `https://pub.fsa.gov.ru/rss/certificate/view/${id}`,
      `https://pub.fsa.gov.ru/rds/certificate/view/${id}/applicant`,
    ];
    for (const url of urls) {
      console.log("goto", url);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForTimeout(8_000);
      } catch (error) {
        console.log("goto fail", error instanceof Error ? error.message : error);
      }
    }

    const unique = new Map<string, (typeof hits)[0]>();
    for (const hit of hits) unique.set(`${hit.method} ${hit.url}`, hit);
    console.log(
      JSON.stringify(
        [...unique.values()].map((h) => ({
          method: h.method,
          status: h.status,
          path: h.url.replace("https://pub.fsa.gov.ru", ""),
        })),
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
