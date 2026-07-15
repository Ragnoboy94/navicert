import { chromium } from "playwright";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { playwrightLaunchOptions } from "./fsa-proxy.mjs";

const FSA_URL = "https://pub.fsa.gov.ru/rds/declaration";
const __filename = fileURLToPath(import.meta.url);

function cardConcurrency() {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_CARD_CONCURRENCY || 6), 1),
    8
  );
}

function pickFromApiApplicant(apiApplicant) {
  return {
    email:
      apiApplicant?.email ||
      apiApplicant?.emailAddress ||
      apiApplicant?.contactEmail ||
      "",
    shortName: apiApplicant?.shortName || "",
    fullName: apiApplicant?.fullName || "",
    phone: apiApplicant?.phone || "",
  };
}

async function scrapeApplicant(context, item) {
  const id = item.id;
  const page = await context.newPage();
  let apiRecord = null;

  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes(`/api/v1/rds/common/declarations/${id}`)) return;
    try {
      const json = await response.json();
      apiRecord = json?.data && typeof json.data === "object" ? json.data : json;
    } catch {
      // ignore
    }
  };

  page.on("response", onResponse);

  try {
    const apiWait = page
      .waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/rds/common/declarations/${id}`) &&
          response.ok(),
        { timeout: 35_000 }
      )
      .catch(() => null);

    await page.goto(`${FSA_URL}/view/${id}/applicant`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    await apiWait;

    const fromApi = pickFromApiApplicant(apiRecord?.applicant || {});
    if (fromApi.email) {
      return {
        id,
        number: item.number,
        registrationDate: item.registrationDate,
        endDate: item.endDate,
        status: item.status || "Действует",
        applicant: {
          shortName: fromApi.shortName || item.applicant?.shortName,
          fullName: fromApi.fullName || item.applicant?.fullName,
          email: fromApi.email,
          phone: fromApi.phone || item.applicant?.phone,
        },
        productName: item.productName,
        productGroup: item.productGroup,
        registryUrl: `${FSA_URL}/view/${id}/applicant`,
      };
    }

    await page
      .locator("text=Адрес электронной почты")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {});

    const data = await page.evaluate(() => {
      const text = document.body.innerText;
      const pick = (label) => {
        const idx = text.indexOf(label);
        if (idx < 0) return "";
        const chunk = text.slice(idx + label.length, idx + label.length + 200);
        return (
          chunk
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)[0] || ""
        );
      };

      const numberMatch = text.match(
        /(ЕАЭС|РОСС|ТС)\s+N?\s*RU[^\n]+от\s+\d{2}\.\d{2}\.\d{4}\s+действует\s+до\s+(\d{2}\.\d{2}\.\d{4})/i
      );

      return {
        number: numberMatch?.[0]?.split(" от ")[0]?.trim() || pick("ЕАЭС"),
        endDate: numberMatch?.[2] || "",
        registrationDate: text.match(/от\s+(\d{2}\.\d{2}\.\d{4})/)?.[1] || "",
        shortName: pick("Сокращенное наименование юридического лица"),
        fullName: pick("Полное наименование юридического лица"),
        email: pick("Адрес электронной почты"),
        phone: pick("Номер телефона"),
        product: pick("Продукция") || pick("Общее наименование продукции"),
      };
    });

    return {
      id,
      number: data.number || item.number,
      registrationDate: data.registrationDate || item.registrationDate,
      endDate: data.endDate || item.endDate,
      status: item.status || "Действует",
      applicant: {
        shortName:
          data.shortName || fromApi.shortName || item.applicant?.shortName,
        fullName: data.fullName || fromApi.fullName || item.applicant?.fullName,
        email: data.email || fromApi.email || item.applicant?.email,
        phone: data.phone || fromApi.phone || item.applicant?.phone,
      },
      productName: data.product || item.productName,
      productGroup: item.productGroup,
      registryUrl: `${FSA_URL}/view/${id}/applicant`,
    };
  } finally {
    page.off("response", onResponse);
    await page.close().catch(() => {});
  }
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (!item?.id) {
        results[index] = item;
        continue;
      }
      try {
        results[index] = await worker(item);
      } catch {
        results[index] = item;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      run()
    )
  );
  return results.filter(Boolean);
}

async function createBrowserSession() {
  const browser = await chromium.launch(playwrightLaunchOptions());
  const context = await browser.newContext({
    locale: "ru-RU",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  // Картинки/шрифты/медиа не нужны — только DOM + XHR к ФСА.
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (
      type === "image" ||
      type === "media" ||
      type === "font" ||
      type === "stylesheet"
    ) {
      return route.abort();
    }
    return route.continue();
  });

  const concurrency = cardConcurrency();

  return {
    concurrency,
    async enrich(items) {
      return mapPool(items, concurrency, (item) => scrapeApplicant(context, item));
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function runOnce() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  const { items = [] } = raw ? JSON.parse(raw) : { items: [] };
  if (items.length === 0) {
    console.log(JSON.stringify({ declarations: [] }));
    return;
  }

  const session = await createBrowserSession();
  try {
    const declarations = await session.enrich(items);
    console.log(JSON.stringify({ declarations }));
  } finally {
    await session.close();
  }
}

async function runDaemon() {
  const session = await createBrowserSession();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const shutdown = async () => {
    rl.close();
    await session.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  // Готовность для родителя
  console.log(JSON.stringify({ ready: true, concurrency: session.concurrency }));

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let payload;
    try {
      payload = JSON.parse(trimmed);
    } catch (error) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
      continue;
    }

    if (payload?.cmd === "shutdown") {
      await shutdown();
      return;
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    try {
      const declarations = await session.enrich(items);
      console.log(JSON.stringify({ declarations }));
    } catch (error) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          declarations: items,
        })
      );
    }
  }

  await session.close();
}

const isDaemon =
  process.argv.includes("--daemon") ||
  process.env.OUTREACH_CARD_DAEMON === "1";

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const run = isDaemon ? runDaemon : runOnce;
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
