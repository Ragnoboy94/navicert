/**
 * Парсер checko.ru для рассылки по новым организациям.
 *
 * Фаза 1 (срочная): только список /search/advanced — без карточек.
 * Фаза 2 (фон): карточки /company/... по одной, с «человеческими» паузами → email.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FsaApplicant, FsaDeclaration } from "./types";
import { ensurePlaywrightBrowsersEnv } from "./playwright-env";
export {
  NEW_REG_WINDOW_DAYS,
  CHECKO_REG_WINDOW_DAYS,
  getNewRegistrationsRange,
  ruDateToIso,
} from "./checko-range";
import { getNewRegistrationsRange, ruDateToIso } from "./checko-range";
import {
  isCheckoBlocked,
  getCheckoBlockReason,
  markCheckoBlocked,
  withCheckoProfileLock,
} from "./checko-guard";

export const CHECKO_BASE = "https://checko.ru";
export const CHECKO_ADVANCED_PATH = "/search/advanced";

const USER_AGENT =
  process.env.OUTREACH_CHECKO_UA?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MONTHS_RU: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
};

export type CheckoListItem = {
  path: string;
  ogrn: string;
  url: string;
  name?: string;
};

export type CheckoCompany = {
  path: string;
  url: string;
  ogrn: string;
  inn?: string;
  shortName?: string;
  fullName?: string;
  registrationDateIso?: string;
  registrationDateRu?: string;
  email?: string;
  emails: string[];
  okved?: string;
};

export type CheckoSearchPage = {
  page: number;
  total: number;
  from: number;
  to: number;
  items: CheckoListItem[];
  hasMore: boolean;
};

export type CheckoScanOptions = {
  dateFrom?: string;
  dateTo?: string;
  /** На срочной фазе всегда false — email в фоне. */
  emailsOnly?: boolean;
  /** Не ходить на карточки (по умолчанию true для срочной загрузки). */
  listOnly?: boolean;
  maxItems?: number;
  maxPages?: number;
  startPage?: number;
  skipOgrns?: Iterable<string>;
  delayMs?: number;
  onPage?: (page: CheckoSearchPage) => void;
  onCompany?: (company: CheckoCompany) => void;
};

export type CheckoScanResult = {
  range: { from: string; to: string };
  pagesFetched: number;
  companies: CheckoCompany[];
  declarations: FsaDeclaration[];
  nextPage: number;
  hasMore: boolean;
  totalOnSite?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Подробные логи checko — только локально / с OUTREACH_DEBUG=1. На проде молчим. */
function checkoDebug(...args: unknown[]): void {
  if (
    process.env.OUTREACH_DEBUG === "1" ||
    process.env.NODE_ENV !== "production"
  ) {
    console.info(...args);
  }
}

function checkoDebugWarn(...args: unknown[]): void {
  if (
    process.env.OUTREACH_DEBUG === "1" ||
    process.env.NODE_ENV !== "production"
  ) {
    console.warn(...args);
  }
}

function isoToRuDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

function humanPauseMs(baseMs: number): number {
  const jitter = 0.55 + Math.random() * 0.9;
  return Math.round(baseMs * jitter);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCheckoRuDate(text: string): {
  iso?: string;
  ru?: string;
} {
  const m = text
    .replace(/\s+/g, " ")
    .match(
      /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/i
    );
  if (!m) return {};
  const day = Number(m[1]);
  const month = MONTHS_RU[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month || !day || !year) return {};
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { iso, ru: isoToRuDate(iso) };
}

export function parseCheckoSearchPage(
  html: string,
  page: number
): CheckoSearchPage {
  const countMatch =
    html.match(/Компании с\s+(\d+)\s+по\s+(\d+)\s+из\s+([\d\s]+)/i) ||
    html.match(/Организации с\s+(\d+)\s+по\s+(\d+)\s+из\s+([\d\s]+)/i);

  let from = 0;
  let to = 0;
  let total = 0;
  if (countMatch) {
    from = Number(countMatch[1]);
    to = Number(countMatch[2]);
    total = Number(countMatch[3].replace(/\s+/g, ""));
  } else if (/не\s+найдено|ничего\s+не\s+найдено/i.test(html)) {
    total = 0;
  }

  const seen = new Set<string>();
  const items: CheckoListItem[] = [];
  const re =
    /href="(\/company\/([a-z0-9\-]+)-(\d{13}))"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const path = m[1];
    const ogrn = m[3];
    if (seen.has(path)) continue;
    // отсекаем служебные /company/select
    if (path.includes("/select")) continue;
    seen.add(path);
    const name = stripTags(m[4]);
    items.push({
      path,
      ogrn,
      url: `${CHECKO_BASE}${path}`,
      name: name || undefined,
    });
  }

  const hasMore =
    total > 0 ? to < total : /[?&]page=\d+|page-item/i.test(html) && items.length > 0;

  return {
    page,
    total,
    from,
    to,
    items,
    hasMore: hasMore && items.length > 0,
  };
}

export function parseCheckoOkved(html: string): string | undefined {
  const sidebar = html.match(
    /Вид деятельности<\/div>\s*<div>([\s\S]*?)<\/div>/i
  )?.[1];
  if (sidebar) {
    const nameRaw =
      sidebar.match(/<a[^>]*class="[^"]*link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
      sidebar.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const codeRaw =
      sidebar.match(/id="activity-name"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      sidebar.match(/>(\d{2}\.\d{2}(?:\.\d{1,2})?)\s*</)?.[1];
    const name = nameRaw ? stripTags(nameRaw) : "";
    const code = codeRaw ? stripTags(codeRaw) : "";
    if (name && code) return `${code} — ${name}`.slice(0, 300);
    if (name) return name.slice(0, 300);
    if (code) return code;
  }

  const row = html.match(
    /id="activity"[\s\S]{0,1200}?<tr>\s*<td[^>]*>\s*([\d.]+)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i
  );
  if (row) {
    const code = stripTags(row[1]);
    const name = stripTags(row[2].replace(/<span[\s\S]*$/i, ""));
    if (name && code) return `${code} — ${name}`.slice(0, 300);
  }
  return undefined;
}

export function parseCheckoCompanyPage(
  html: string,
  path: string
): CheckoCompany {
  const ogrnFromPath = path.match(/-(\d{13})(?:\/|$)/)?.[1] ?? "";
  const ogrn =
    html.match(/id="copy-ogrn"[^>]*>\s*(\d{13})/i)?.[1] ||
    html.match(/"propertyID":"ОГРН","value":"(\d{13})"/)?.[1] ||
    html.match(/ОГРН[^0-9]{0,40}(\d{13})/i)?.[1] ||
    ogrnFromPath;

  const inn =
    html.match(/id="copy-inn"[^>]*>\s*(\d{10,12})/i)?.[1] ||
    html.match(/"taxID":"(\d{10,12})"/)?.[1] ||
    html.match(/ИНН[^0-9]{0,40}(\d{10,12})/i)?.[1];

  const shortNameRaw =
    html.match(/id="cn"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const shortName = shortNameRaw ? stripTags(shortNameRaw) : undefined;

  const fullName =
    html.match(/"legalName":"([^"]+)"/)?.[1]?.replace(/\\"/g, '"') ||
    shortName;

  const founding = html.match(/"foundingDate":"(\d{4}-\d{2}-\d{2})"/)?.[1];
  const regBlock =
    html.match(/Дата регистрации[\s\S]{0,120}?(\d{1,2}\s+[а-яё]+\s+\d{4})/i)?.[1] ||
    "";
  const parsedRu = parseCheckoRuDate(regBlock || html);
  const registrationDateIso = founding || parsedRu.iso;
  const registrationDateRu =
    parsedRu.ru ||
    (registrationDateIso ? isoToRuDate(registrationDateIso) : undefined);

  const contactSection =
    html.match(/Электронная почта[\s\S]*?(?:Веб-сайт|Предложить исправление)/i)?.[0] ||
    html.match(/Электронная почта[\s\S]{0,1200}/i)?.[0] ||
    "";

  const emails: string[] = [];
  const pushEmail = (raw: string) => {
    const email = raw.trim().toLowerCase();
    if (!email || /checko\.ru/i.test(email)) return;
    if (!emails.includes(email)) emails.push(email);
  };

  const mailRe = /mailto:([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/gi;
  let em: RegExpExecArray | null;
  while ((em = mailRe.exec(contactSection))) pushEmail(em[1]);

  // Иногда на карточке текст без mailto:
  const textEmailRe =
    /(?:Электронная почта|E-?mail|Email)[^A-Z0-9@]{0,80}([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/gi;
  while ((em = textEmailRe.exec(contactSection || html))) pushEmail(em[1]);

  if (emails.length === 0) {
    while ((em = mailRe.exec(html))) pushEmail(em[1]);
  }
  if (emails.length === 0) {
    const bare = html.match(
      />([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})</gi
    );
    for (const tag of bare || []) {
      const m = tag.match(/([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i);
      if (m) pushEmail(m[1]);
    }
  }

  return {
    path,
    url: `${CHECKO_BASE}${path}`,
    ogrn,
    inn,
    shortName,
    fullName,
    registrationDateIso,
    registrationDateRu,
    email: emails[0],
    emails,
    okved: parseCheckoOkved(html),
  };
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return h === 0 ? 1 : h;
}

export function checkoCompanyToDeclaration(
  company: CheckoCompany
): FsaDeclaration {
  const ogrnNum = Number(company.ogrn);
  const id = Number.isFinite(ogrnNum)
    ? ogrnNum
    : Math.abs(hashString(company.ogrn || company.path));
  const regRu =
    company.registrationDateRu ||
    (company.registrationDateIso
      ? isoToRuDate(company.registrationDateIso)
      : "");

  const applicant: FsaApplicant = {
    type: "ul",
    ogrn: company.ogrn,
    inn: company.inn,
    shortName: company.shortName,
    fullName: company.fullName || company.shortName,
    email: company.email,
  };

  return {
    id,
    number: company.ogrn || String(id),
    registrationDate: regRu,
    endDate: regRu,
    status: "active",
    applicant,
    productName: company.okved || "Новая организация",
    productGroup: company.okved,
    registryUrl: company.url,
  };
}

function listItemToCompany(item: CheckoListItem): CheckoCompany {
  return {
    path: item.path,
    url: item.url,
    ogrn: item.ogrn,
    shortName: item.name,
    fullName: item.name,
    emails: [],
  };
}

function buildFilterPayload(dateFrom: string, dateTo: string) {
  return {
    entity: "organizations",
    active_checkbox: "true",
    activities: [],
    locations: [],
    search: "",
    date_from: dateFrom,
    date_to: dateTo,
    smb_checkbox: "",
    smb_code: "",
    employee_checkbox: "",
    employee_min: "",
    employee_max: "",
    capital_checkbox: "",
    capital_min: "",
    accounting_2110_checkbox: "",
    accounting_2110_min: "",
    accounting_2110_max: "",
    accounting_2400_checkbox: "",
    accounting_2400_min: "",
    accounting_2400_max: "",
    accounting_1300_checkbox: "",
    accounting_1300_min: "",
    accounting_1300_max: "",
    tax_treatment_checkbox: "",
    tax_treatment_code: "",
    tax_amount_checkbox: "",
    tax_amount_min: "",
    purchases_checkbox: "",
    purchases_customer_min: "",
    purchases_supplier_min: "",
    licenses_checkbox: "",
    trademarks_checkbox: "",
    phones_checkbox: "",
    emails_checkbox: "",
    websites_checkbox: "",
  };
}

async function passCheckoChallengeIfNeeded(
  page: {
    content: () => Promise<string>;
    reload: (options?: {
      waitUntil?: "domcontentloaded";
      timeout?: number;
    }) => Promise<unknown>;
    locator: (selector: string) => {
      first: () => {
        click: (options?: { timeout?: number }) => Promise<unknown>;
      };
    };
    frames: () => Array<{
      locator: (selector: string) => {
        first: () => {
          click: (options?: { timeout?: number }) => Promise<unknown>;
        };
      };
    }>;
    waitForTimeout?: (ms: number) => Promise<void>;
  },
  headed: boolean
): Promise<void> {
  let html = await page.content();
  if (!/подтвердите, что вы человек|большое количество запросов/i.test(html)) {
    return;
  }
  if (headed) {
    checkoDebug("[checko] Капча: ждём ручную проверку в окне…");
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await sleep(2000);
      html = await page.content();
      if (!/подтвердите, что вы человек|большое количество запросов/i.test(html)) {
        return;
      }
    }
    throw new Error("CHECKO_ACCESS_LIMITED");
  }

  for (let attempt = 1; attempt <= 4; attempt++) {
    await page
      .locator('button:has-text("Подтвердить")')
      .first()
      .click({ timeout: 2500 })
      .catch(() => undefined);
    await page
      .locator(".smart-captcha, [class*=SmartCaptcha], iframe")
      .first()
      .click({ timeout: 2500 })
      .catch(() => undefined);
    for (const frame of page.frames()) {
      await frame
        .locator(
          'input[type="checkbox"], #js-button, .CheckboxCaptcha-Button, [role="checkbox"]'
        )
        .first()
        .click({ timeout: 1500 })
        .catch(() => undefined);
    }
    await sleep(2000 * attempt);
    html = await page.content();
    if (!/подтвердите, что вы человек|большое количество запросов/i.test(html)) {
      return;
    }
    await page
      .reload({ waitUntil: "domcontentloaded", timeout: 60_000 })
      .catch(() => undefined);
  }
  throw new Error("CHECKO_ACCESS_LIMITED");
}

function resolveChromePath(browsersPath: string): string | undefined {
  const candidates = [
    path.join(browsersPath, "chromium-1228", "chrome-win64", "chrome.exe"),
    path.join(browsersPath, "chromium-1228", "chrome-linux64", "chrome"),
    path.join(
      browsersPath,
      "chromium_headless_shell-1228",
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe"
    ),
    path.join(
      browsersPath,
      "chromium_headless_shell-1228",
      "chrome-headless-shell-linux64",
      "chrome-headless-shell"
    ),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

// Playwright types через dynamic import часто ломают tsc — держим loosely.
async function openCheckoContext(headed: boolean): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
}> {
  const browsersPath = ensurePlaywrightBrowsersEnv();
  const { chromium } = await import("playwright");
  const profileDir = path.join(process.cwd(), "data", "checko-pw-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  const executablePath = resolveChromePath(browsersPath);
  if (!executablePath && !process.env.OUTREACH_CHECKO_CHANNEL?.trim()) {
    throw new Error("Не найден браузер для загрузки с checko.");
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    executablePath: process.env.OUTREACH_CHECKO_CHANNEL?.trim()
      ? undefined
      : executablePath,
    channel: process.env.OUTREACH_CHECKO_CHANNEL?.trim() || undefined,
    userAgent: USER_AGENT,
    viewport: { width: 1365, height: 900 },
    locale: "ru-RU",
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

/**
 * Срочная фаза: только страницы списка (без карточек).
 */
export async function scanCheckoNewRegistrationsInProcess(
  options: CheckoScanOptions = {}
): Promise<CheckoScanResult> {
  if (isCheckoBlocked()) {
    throw new Error(getCheckoBlockReason() || "CHECKO_ACCESS_LIMITED");
  }
  return withCheckoProfileLock(
    () => scanCheckoNewRegistrationsUnlocked(options),
    { label: "scan", waitMs: 180_000 }
  );
}

async function scanCheckoNewRegistrationsUnlocked(
  options: CheckoScanOptions = {}
): Promise<CheckoScanResult> {
  const defaultRange = getNewRegistrationsRange();
  const dateFrom =
    options.dateFrom?.trim() || ruDateToIso(defaultRange.from);
  const dateTo = options.dateTo?.trim() || ruDateToIso(defaultRange.to);
  const listOnly = options.listOnly !== false;
  const maxItems = Math.min(Math.max(options.maxItems ?? 100, 1), 1000);
  const maxPages = Math.min(Math.max(options.maxPages ?? 40, 1), 200);
  const delayMs = Math.max(
    options.delayMs ?? Number(process.env.OUTREACH_CHECKO_DELAY_MS || 1800),
    800
  );
  const startPage = Math.max(options.startPage ?? 1, 1);
  const skip = new Set(
    [...(options.skipOgrns ?? [])].map((x) => String(x).trim()).filter(Boolean)
  );
  const headed = process.env.OUTREACH_CHECKO_HEADED === "1";

  const { context, page } = await openCheckoContext(headed);
  const companies: CheckoCompany[] = [];
  let pagesFetched = 0;
  let pageNum = startPage;
  let hasMore = true;
  let totalOnSite: number | undefined;
  let nextPage = startPage;

  try {
    await page.goto(`${CHECKO_BASE}${CHECKO_ADVANCED_PATH}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await passCheckoChallengeIfNeeded(page, headed);

    const payload = buildFilterPayload(dateFrom, dateTo);
    const filterStatus = await page.evaluate(
      async ({ body, base }: { body: unknown; base: string }) => {
        const token =
          document
            .querySelector('meta[name="csrf-token"]')
            ?.getAttribute("content") || "";
        const res = await fetch(`${base}/local-storage/update/advanced-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-TOKEN": token,
            "X-Requested-With": "XMLHttpRequest",
          },
          body: `data=${encodeURIComponent(JSON.stringify(body))}`,
          credentials: "same-origin",
        });
        return res.status;
      },
      { body: payload, base: CHECKO_BASE }
    );
    if (filterStatus >= 400) {
      throw new Error(`Не удалось применить фильтр на checko (код ${filterStatus}).`);
    }

    await page.goto(`${CHECKO_BASE}${CHECKO_ADVANCED_PATH}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await passCheckoChallengeIfNeeded(page, headed);

    while (companies.length < maxItems && pagesFetched < maxPages && hasMore) {
      if (pagesFetched > 0 && delayMs) await sleep(humanPauseMs(delayMs));
      const url =
        pageNum <= 1
          ? `${CHECKO_BASE}${CHECKO_ADVANCED_PATH}`
          : `${CHECKO_BASE}${CHECKO_ADVANCED_PATH}?page=${pageNum}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await passCheckoChallengeIfNeeded(page, headed);
      pagesFetched += 1;

      const html = await page.content();
      const list = parseCheckoSearchPage(html, pageNum);
      totalOnSite = list.total || totalOnSite;
      options.onPage?.(list);

      for (const item of list.items) {
        if (companies.length >= maxItems) break;
        if (skip.has(item.ogrn)) continue;
        skip.add(item.ogrn);

        let company = listItemToCompany(item);
        if (!listOnly) {
          if (delayMs) await sleep(humanPauseMs(delayMs));
          await page.goto(item.url, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          });
          await passCheckoChallengeIfNeeded(page, headed);
          company = parseCheckoCompanyPage(await page.content(), item.path);
        }

        if (options.emailsOnly && !company.email) continue;
        companies.push(company);
        options.onCompany?.(company);
      }

      hasMore = list.hasMore && list.items.length > 0;
      nextPage = hasMore ? pageNum + 1 : pageNum;
      pageNum += 1;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/CHECKO_ACCESS_LIMITED|капч|большое количество|429/i.test(msg)) {
      markCheckoBlocked(msg.slice(0, 120));
    }
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }

  return {
    range: { from: isoToRuDate(dateFrom), to: isoToRuDate(dateTo) },
    pagesFetched,
    companies,
    declarations: companies.map(checkoCompanyToDeclaration),
    nextPage,
    hasMore,
    totalOnSite,
  };
}

const CHECKO_SCAN_TIMEOUT_MS = Math.max(
  Number(process.env.OUTREACH_CHECKO_SCAN_TIMEOUT_MS || 240_000),
  60_000
);

export async function scanCheckoNewRegistrations(
  options: CheckoScanOptions = {}
): Promise<CheckoScanResult> {
  const scanOpts = {
    ...options,
    listOnly: options.listOnly !== false,
  };

  if (
    process.env.OUTREACH_CHECKO_WORKER === "1" ||
    process.env.OUTREACH_CHECKO_INPROCESS === "1"
  ) {
    return scanCheckoNewRegistrationsInProcess(scanOpts);
  }

  const worker = path.join(
    process.cwd(),
    "scripts",
    "outreach",
    "scan-checko-worker.mts"
  );
  const tsxCli = path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );

  // На проде без tsx/скрипта — in-process (Linux/pm2 это нормально).
  if (!fs.existsSync(worker) || !fs.existsSync(tsxCli)) {
    checkoDebugWarn(
      "[checko] worker/tsx недоступны — сканируем in-process"
    );
    return scanCheckoNewRegistrationsInProcess(scanOpts);
  }

  const payload = JSON.stringify({
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    emailsOnly: false,
    listOnly: options.listOnly !== false,
    maxItems: options.maxItems,
    maxPages: options.maxPages,
    startPage: options.startPage,
    skipOgrns: options.skipOgrns ? [...options.skipOgrns] : undefined,
    delayMs: options.delayMs,
  });

  try {
    return await spawnCheckoScanWorker(tsxCli, worker, payload);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Windows EINVAL / missing binary — не роняем прод, пробуем in-process.
    if (/EINVAL|ENOENT|spawn/i.test(msg)) {
      checkoDebugWarn(`[checko] worker spawn failed (${msg}) — in-process`);
      return scanCheckoNewRegistrationsInProcess(scanOpts);
    }
    throw error;
  }
}

function spawnCheckoScanWorker(
  tsxCli: string,
  worker: string,
  payload: string
): Promise<CheckoScanResult> {
  return new Promise((resolve, reject) => {
    // node + tsx/cli: работает на Linux-проде и на Windows (без npx.cmd EINVAL).
    const childEnv = {
      ...process.env,
      OUTREACH_CHECKO_WORKER: "1",
      PLAYWRIGHT_BROWSERS_PATH: ensurePlaywrightBrowsersEnv(),
    };
    const child = spawn(process.execPath, [tsxCli, worker, payload], {
      cwd: process.cwd(),
      env: childEnv,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `checko scan timeout (${Math.round(CHECKO_SCAN_TIMEOUT_MS / 1000)}s)`
        )
      );
    }, CHECKO_SCAN_TIMEOUT_MS);

    child.stdout.on("data", (buf) => {
      const text = String(buf);
      stdout += text;
      if (text.trim()) checkoDebug(`[checko-worker] ${text.trim()}`);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const marker = "CHECKO_SCAN_RESULT=";
      const line = stdout
        .split(/\r?\n/)
        .reverse()
        .find((l) => l.includes(marker));
      if (line) {
        try {
          const raw = line.slice(line.indexOf(marker) + marker.length);
          const parsed = JSON.parse(raw) as
            | CheckoScanResult
            | { ok: false; error?: string };
          if ("ok" in parsed && parsed.ok === false) {
            reject(new Error(parsed.error || "checko worker failed"));
            return;
          }
          resolve(parsed as CheckoScanResult);
          return;
        } catch (error) {
          reject(
            new Error(
              `checko worker: bad JSON (${error instanceof Error ? error.message : error})`
            )
          );
          return;
        }
      }
      reject(
        new Error(
          `checko worker exit ${code}: ${(stderr || stdout).slice(0, 800) || "no output"}`
        )
      );
    });
  });
}

/**
 * Фон: карточки → email в одной сессии браузера (не перезапускать Chrome на каждую).
 */
export type CheckoEnrichItemResult = {
  url: string;
  company?: CheckoCompany;
  error?: string;
  blocked?: boolean;
};

function toCompanyPath(registryUrlOrPath: string): string {
  const pathOrUrl = registryUrlOrPath.trim();
  if (pathOrUrl.startsWith("http")) return new URL(pathOrUrl).pathname;
  if (pathOrUrl.startsWith("/")) return pathOrUrl;
  return `/company/${pathOrUrl}`;
}

export function getCheckoEnrichDelayMs(): number {
  return Math.max(
    Number(process.env.OUTREACH_CHECKO_ENRICH_DELAY_MS || 9000),
    4000
  );
}

export async function enrichCheckoCompanyEmails(
  urls: string[],
  options?: { shouldAbort?: () => boolean }
): Promise<CheckoEnrichItemResult[]> {
  if (urls.length === 0) return [];
  if (isCheckoBlocked()) {
    const reason = getCheckoBlockReason() || "CHECKO_ACCESS_LIMITED";
    return urls.map((url) => ({ url, error: reason, blocked: true }));
  }

  return withCheckoProfileLock(
    async () => {
      const headed = process.env.OUTREACH_CHECKO_HEADED === "1";
      const pauseBase = getCheckoEnrichDelayMs();
      const { context, page } = await openCheckoContext(headed);
      const results: CheckoEnrichItemResult[] = [];
      try {
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          if (options?.shouldAbort?.()) {
            for (let j = i; j < urls.length; j++) {
              results.push({ url: urls[j], error: "aborted" });
            }
            break;
          }
          // Пауза перед каждой карточкой (и первой) — меньше «робота».
          await sleep(humanPauseMs(pauseBase));
          const companyPath = toCompanyPath(url);
          try {
            await page.goto(`${CHECKO_BASE}${companyPath}`, {
              waitUntil: "domcontentloaded",
              timeout: 90_000,
            });
            await passCheckoChallengeIfNeeded(page, headed);
            await sleep(humanPauseMs(1500));
            const company = parseCheckoCompanyPage(
              await page.content(),
              companyPath
            );
            checkoDebug(
              `[checko-enrich] ${company.ogrn || companyPath} | ${company.shortName || "—"} | email=${company.email || "нет"} | all=${company.emails.join(",") || "—"}`
            );
            results.push({ url, company });
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const blocked =
              /CHECKO_ACCESS_LIMITED|капч|большое количество|429/i.test(msg);
            if (blocked) markCheckoBlocked(msg.slice(0, 120));
            checkoDebugWarn(`[checko-enrich] FAIL ${companyPath}: ${msg}`);
            results.push({ url, error: msg, blocked });
            if (blocked) {
              for (let j = i + 1; j < urls.length; j++) {
                results.push({
                  url: urls[j],
                  error: "CHECKO_ACCESS_LIMITED",
                  blocked: true,
                });
              }
              break;
            }
          }
        }
      } finally {
        await context.close().catch(() => undefined);
      }
      return results;
    },
    { label: "enrich", waitMs: 180_000 }
  );
}

/** Одна карточка (удобно для скриптов). В проде предпочитайте enrichCheckoCompanyEmails. */
export async function enrichCheckoCompanyEmail(
  registryUrlOrPath: string
): Promise<CheckoCompany> {
  const [result] = await enrichCheckoCompanyEmails([registryUrlOrPath]);
  if (result?.company) return result.company;
  throw new Error(result?.error || "CHECKO_ACCESS_LIMITED");
}
