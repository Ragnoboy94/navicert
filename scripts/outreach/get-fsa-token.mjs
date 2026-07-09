import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightLaunchOptions } from "./fsa-proxy.mjs";

const FSA_URL = "https://pub.fsa.gov.ru/rds/declaration";

export async function captureFsaBearerToken() {
  const browser = await chromium.launch(playwrightLaunchOptions());
  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    let bearerToken = process.env.FSA_BEARER_TOKEN?.trim() || "";

    const captureAuth = (headers) => {
      const auth =
        headers?.authorization ||
        headers?.Authorization ||
        (typeof headers === "object" && headers !== null
          ? Object.entries(headers).find(([k]) => k.toLowerCase() === "authorization")?.[1]
          : undefined);
      if (typeof auth === "string" && auth.startsWith("Bearer ")) {
        bearerToken = auth.slice(7);
      }
    };

    page.on("request", (request) => captureAuth(request.headers()));
    page.on("response", (response) => captureAuth(response.request().headers()));

    await page.goto(FSA_URL, { waitUntil: "commit", timeout: 120_000 });
    for (let i = 0; i < 12 && !bearerToken; i += 1) {
      await page.waitForTimeout(5000);
    }

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
