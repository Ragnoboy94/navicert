import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightLaunchOptions } from "./fsa-proxy.mjs";

const FSA_URL = "https://pub.fsa.gov.ru/rds/declaration";

export async function captureFsaBearerToken() {
  const browser = await chromium.launch(playwrightLaunchOptions());  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    let bearerToken = process.env.FSA_BEARER_TOKEN?.trim() || "";

    page.on("request", (request) => {
      const auth = request.headers().authorization;
      if (auth?.startsWith("Bearer ")) bearerToken = auth.slice(7);
    });

    await page.goto(FSA_URL, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForTimeout(8000);

    if (!bearerToken) {
      throw new Error("Не удалось перехватить Bearer-токен ФСА");
    }

    return bearerToken;
  } finally {
    await browser.close();
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const token = await captureFsaBearerToken();
  console.log(JSON.stringify({ token }));
}
