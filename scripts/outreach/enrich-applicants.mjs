import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FSA_URL = "https://pub.fsa.gov.ru/rds/declaration";
const __filename = fileURLToPath(import.meta.url);

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return { items: [] };
  return JSON.parse(raw);
}

async function scrapeApplicant(page, item) {
  const id = item.id;
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

  await page.goto(`${FSA_URL}/view/${id}/applicant`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page
    .locator("text=Адрес электронной почты")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(1200);

  page.off("response", onResponse);

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

  const apiApplicant = apiRecord?.applicant || {};
  const apiEmail =
    apiApplicant.email ||
    apiApplicant.emailAddress ||
    apiApplicant.contactEmail ||
    "";

  return {
    id,
    number: data.number || item.number,
    registrationDate: data.registrationDate || item.registrationDate,
    endDate: data.endDate || item.endDate,
    status: item.status || "Действует",
    applicant: {
      shortName: data.shortName || apiApplicant.shortName || item.applicant?.shortName,
      fullName: data.fullName || apiApplicant.fullName || item.applicant?.fullName,
      email: data.email || apiEmail || item.applicant?.email,
      phone: data.phone || apiApplicant.phone || item.applicant?.phone,
    },
    productName: data.product || item.productName,
    productGroup: item.productGroup,
    registryUrl: `${FSA_URL}/view/${id}/applicant`,
  };
}

async function main() {
  const { items = [] } = await readInput();
  if (items.length === 0) {
    console.log(JSON.stringify({ declarations: [] }));
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newContext({
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }).then((ctx) => ctx.newPage());

    const declarations = [];
    for (const item of items) {
      if (!item?.id) continue;
      try {
        declarations.push(await scrapeApplicant(page, item));
      } catch {
        declarations.push(item);
      }
    }

    console.log(JSON.stringify({ declarations }));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
