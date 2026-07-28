/**
 * Playwright: перехват реального certificate API с /rss/certificate.
 * Сравнивает с declarations. Не печатает токен.
 *
 * Запуск:
 *   $env:PLAYWRIGHT_BROWSERS_PATH=(Resolve-Path .playwright-browsers).Path
 *   npx tsx scripts/outreach/capture-certificate-api.mts
 */
import { chromium, type Request } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightLaunchOptions } from "./fsa-proxy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() ||
  path.join(root, ".playwright-browsers");

type Captured = {
  method: string;
  url: string;
  status?: number;
  postData?: string;
};

function summarizeBody(raw?: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      keys: Object.keys(parsed),
      size: parsed.size,
      page: parsed.page,
      sort: parsed.sort,
      filter: parsed.filter,
    };
  } catch {
    return { raw: raw.slice(0, 400) };
  }
}

async function captureOnPage(uiPath: string, label: string): Promise<Captured[]> {
  const browser = await chromium.launch(playwrightLaunchOptions());
  const hits: Captured[] = [];

  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    page.on("request", (request: Request) => {
      const url = request.url();
      if (!/\/api\/v1\/r[ds]s?\/common\//.test(url)) return;
      hits.push({
        method: request.method(),
        url,
        postData: request.postData() ?? undefined,
      });
    });

    page.on("response", (response) => {
      const url = response.url();
      if (!/\/api\/v1\/r[ds]s?\/common\//.test(url)) return;
      const existing = [...hits]
        .reverse()
        .find(
          (h) =>
            h.url === url &&
            h.method === response.request().method() &&
            h.status == null
        );
      if (existing) existing.status = response.status();
      else {
        hits.push({
          method: response.request().method(),
          url,
          status: response.status(),
          postData: response.request().postData() ?? undefined,
        });
      }
    });

    console.log(`\n=== ${label}: open ${uiPath} ===`);
    await page.goto(`https://pub.fsa.gov.ru${uiPath}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForTimeout(12_000);

    const unique = new Map<string, Captured>();
    for (const hit of hits) {
      unique.set(`${hit.method} ${hit.url}`, hit);
    }
    const list = [...unique.values()];
    console.log(`captured ${list.length} API calls`);
    for (const hit of list) {
      console.log(
        JSON.stringify(
          {
            method: hit.method,
            status: hit.status,
            path: hit.url.replace("https://pub.fsa.gov.ru", ""),
            body: summarizeBody(hit.postData),
          },
          null,
          2
        )
      );
    }
    return list;
  } finally {
    await browser.close();
  }
}

async function main() {
  const cert = await captureOnPage("/rss/certificate", "certificates(rss)");
  const decl = await captureOnPage("/rds/declaration", "declarations(rds)");

  const certGet = cert.find((c) =>
    /certificates\/get|certificate\/get/.test(c.url)
  );
  const declGet = decl.find((d) => /declarations\/get/.test(d.url));

  console.log("\n=== assert paths ===");
  console.log({
    certListPath: certGet?.url.replace("https://pub.fsa.gov.ru", "") ?? null,
    declListPath: declGet?.url.replace("https://pub.fsa.gov.ru", "") ?? null,
    certUsesRss: Boolean(certGet?.url.includes("/rss/")),
    declUsesRds: Boolean(declGet?.url.includes("/rds/")),
  });

  if (certGet && !certGet.url.includes("/api/v1/rss/")) {
    throw new Error(`Unexpected certificate API namespace: ${certGet.url}`);
  }
  if (declGet && !declGet.url.includes("/api/v1/rds/")) {
    throw new Error(`Unexpected declaration API namespace: ${declGet.url}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
