/**
 * Карточки продавцов Wildberries для 4-й рассылки.
 *
 * Только Playwright (как checko): обычный fetch/API WB режет антиботом.
 * Скан: главная → sellerId с ленты/товаров → /seller/{id}.
 * Если на карточке есть email — берём имя и почту.
 * Если нет, но есть ИНН — позже ищем почту на checko (см. lookupCheckoCompanyByInn).
 * Уже просмотренных (sellerId / ИНН) больше не открываем.
 */

import fs from "node:fs";
import path from "node:path";
import type { FsaApplicant, FsaDeclaration } from "./types";
import { ensurePlaywrightBrowsersEnv } from "./playwright-env";
import { withCheckoProfileLock } from "./checko-guard";
import { getFsaProxy, playwrightProxyOptions } from "./fsa-proxy-shared";

export const WB_BASE = "https://www.wildberries.ru";
export const WB_CATEGORY = "wb_sellers" as const;

const USER_AGENT =
  process.env.OUTREACH_WB_UA?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SEEN_FILE = path.join(
  process.cwd(),
  "data",
  "outreach-wb-sellers-seen.json"
);
const PROFILE_DIR = path.join(process.cwd(), "data", "wb-pw-profile");
const PROFILE_LOCK = path.join(process.cwd(), "data", "wb-pw-profile.lock");

const SKIP_EMAIL_HOSTS =
  /wildberries\.ru|wb\.ru|wbbasket\.ru|rwb\.ru|wbstatic\.net|captcha-support/i;

export type WbSellerCard = {
  sellerId: string;
  url: string;
  name?: string;
  legalName?: string;
  inn?: string;
  ogrn?: string;
  email?: string;
  emails: string[];
};

export type WbSeenRecord = {
  sellerId: string;
  inn?: string;
  name?: string;
  email?: string;
  emailSource?: "wb" | "checko";
  searchedWbAt: string;
  searchedCheckoAt?: string;
};

type WbSeenStore = {
  bySellerId: Record<string, WbSeenRecord>;
  byInn: Record<string, string>;
};

export type WbCatalogPage = {
  page: number;
  sellerIds: string[];
  names: Record<string, string>;
  hasMore: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function wbListDelayMs(override?: number): number {
  if (override != null) return Math.max(override, 0);
  return Math.min(
    Math.max(Number(process.env.OUTREACH_WB_DELAY_MS || 2200), 800),
    12_000
  );
}

export function getWbSellersRange(): { from: string; to: string } {
  return { from: "01.01.2000", to: "31.12.2099" };
}

function todayIso(): string {
  return new Date().toISOString();
}

function emptyStore(): WbSeenStore {
  return { bySellerId: {}, byInn: {} };
}

export function readWbSeenStore(): WbSeenStore {
  try {
    if (!fs.existsSync(SEEN_FILE)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")) as WbSeenStore;
    return {
      bySellerId: raw.bySellerId && typeof raw.bySellerId === "object" ? raw.bySellerId : {},
      byInn: raw.byInn && typeof raw.byInn === "object" ? raw.byInn : {},
    };
  } catch {
    return emptyStore();
  }
}

export function writeWbSeenStore(store: WbSeenStore): void {
  const dir = path.dirname(SEEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(store), "utf8");
}

export function rememberWbSeller(
  patch: Partial<WbSeenRecord> & { sellerId: string }
): WbSeenRecord {
  const store = readWbSeenStore();
  const prev = store.bySellerId[patch.sellerId];
  const next: WbSeenRecord = {
    sellerId: patch.sellerId,
    searchedWbAt: patch.searchedWbAt || prev?.searchedWbAt || todayIso(),
    inn: patch.inn || prev?.inn,
    name: patch.name || prev?.name,
    email: patch.email || prev?.email,
    emailSource: patch.emailSource || prev?.emailSource,
    searchedCheckoAt: patch.searchedCheckoAt || prev?.searchedCheckoAt,
  };
  store.bySellerId[next.sellerId] = next;
  if (next.inn) store.byInn[next.inn] = next.sellerId;
  writeWbSeenStore(store);
  return next;
}

export function wasWbSellerSearched(sellerId: string): boolean {
  return Boolean(readWbSeenStore().bySellerId[String(sellerId)]);
}

export function wasWbInnSearchedOnChecko(inn: string): boolean {
  const store = readWbSeenStore();
  const sellerId = store.byInn[inn];
  if (!sellerId) return false;
  return Boolean(store.bySellerId[sellerId]?.searchedCheckoAt);
}

const INN_RE = /(?:ИНН|номер регистрации)[^\d]{0,24}(\d{10}|\d{12})/i;
const OGRN_RE = /(?:ОГРН(?:ИП)?|ogrn(?:ip)?)[^\d]{0,24}(\d{13}|\d{15})/i;
const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const BAD_SELLER_NAMES = /^(все товары|каталог|wildberries|wb)$/i;

type WbSupplierJson = {
  supplierId?: number | string;
  supplierName?: string;
  supplierFullName?: string;
  inn?: string;
  ogrn?: string;
  ogrnip?: string;
  trademark?: string;
  taxpayerCode?: string;
  email?: string;
  emails?: string[];
};

function pushEmail(list: string[], raw: string | undefined): void {
  const email = String(raw || "").trim().toLowerCase();
  if (!email || SKIP_EMAIL_HOSTS.test(email)) return;
  if (!list.includes(email)) list.push(email);
}

function cleanName(raw: string | undefined): string | undefined {
  const name = String(raw || "")
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!name || BAD_SELLER_NAMES.test(name)) return undefined;
  return name;
}

export function applyWbSupplierJson(
  card: WbSellerCard,
  json: WbSupplierJson | null | undefined
): WbSellerCard {
  if (!json) return card;
  const emails = [...card.emails];
  pushEmail(emails, json.email);
  for (const item of json.emails || []) pushEmail(emails, item);
  const trademark = cleanName(json.trademark);
  const shortName = cleanName(json.supplierName);
  const fullName = cleanName(json.supplierFullName);
  const inn =
    String(json.inn || json.taxpayerCode || "")
      .replace(/\D/g, "")
      .match(/^(\d{10}|\d{12})$/)?.[1] || card.inn;
  const ogrn =
    String(json.ogrnip || json.ogrn || "")
      .replace(/\D/g, "")
      .match(/^(\d{13}|\d{15})$/)?.[1] || card.ogrn;
  return {
    ...card,
    // Юр. имя для рассылки; бренд (St.Tropez) — не главный заголовок
    name: shortName || fullName || trademark || card.name,
    legalName: fullName || shortName || card.legalName,
    inn,
    ogrn,
    email: emails[0] || card.email,
    emails,
  };
}

export function parseWbSellerHtml(
  html: string,
  sellerId: string,
  pageText = ""
): WbSellerCard {
  const blob = `${html}\n${pageText}`;
  const emails: string[] = [];
  const mailRe = /mailto:([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = mailRe.exec(html))) pushEmail(emails, m[1]);
  while ((m = EMAIL_RE.exec(blob))) pushEmail(emails, m[0]);

  const inn = blob.match(INN_RE)?.[1];
  const ogrn = blob.match(OGRN_RE)?.[1];

  const nameFromH1 = cleanName(
    html
      .match(/<h1[^>]*>([\s\S]{0,180}?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  const trademark = cleanName(
    html.match(/"(?:trademark|tradeMark)"\s*:\s*"((?:\\.|[^"\\]){1,120})"/)?.[1]
  );
  const jsonName = cleanName(
    html.match(
      /"(?:supplierFullName|supplierName|sellerName)"\s*:\s*"((?:\\.|[^"\\]){2,200})"/
    )?.[1]
  );
  const jsonInn = html.match(/"(?:inn|taxpayerCode)"\s*:\s*"?(\d{10}|\d{12})"?/)?.[1];
  const jsonOgrn = html.match(
    /"(?:ogrnip|ogrn|OGRN)"\s*:\s*"?(\d{13}|\d{15})"?/
  )?.[1];

  return {
    sellerId: String(sellerId),
    url: `${WB_BASE}/seller/${sellerId}`,
    name: jsonName || nameFromH1 || trademark,
    legalName: jsonName || trademark,
    inn: jsonInn || inn,
    ogrn: jsonOgrn || ogrn,
    email: emails[0],
    emails,
  };
}

async function fetchWbSupplierJson(
  sellerId: string
): Promise<WbSupplierJson | null> {
  const hosts = [
    "static-basket-01.wbbasket.ru",
    "static-basket-02.wbbasket.ru",
    "static-basket-03.wbbasket.ru",
    "static-basket-04.wbbasket.ru",
    "static-basket-05.wbbasket.ru",
  ];
  for (const host of hosts) {
    const url = `https://${host}/vol0/data/supplier-by-id/${sellerId}.json`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as WbSupplierJson;
      if (json?.inn || json?.supplierFullName || json?.trademark) return json;
    } catch {
      /* next host */
    }
  }
  return null;
}

export function sellerIdToNumericId(sellerId: string): number {
  const n = Number(String(sellerId).replace(/\D/g, ""));
  if (Number.isFinite(n) && n > 0) return n;
  let h = 0;
  for (let i = 0; i < sellerId.length; i++) {
    h = (h * 31 + sellerId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

export function wbSellerToDeclaration(card: WbSellerCard): FsaDeclaration {
  const name = card.legalName || card.name || `Продавец ${card.sellerId}`;
  const applicant: FsaApplicant = {
    type: "ul",
    inn: card.inn,
    ogrn: card.ogrn,
    shortName: card.name || name,
    fullName: name,
    email: card.email,
  };
  const today = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  return {
    id: sellerIdToNumericId(card.sellerId),
    number: card.sellerId,
    registrationDate: today,
    endDate: today,
    status: "active",
    applicant,
    productName: name,
    productGroup: card.email ? "WB" : card.inn ? "ИНН" : "WB",
    registryUrl: card.url,
  };
}

function collectSupplierIds(payload: unknown): { id: string; name?: string }[] {
  const out: { id: string; name?: string }[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const raw = obj.supplierId ?? obj.supplier_id ?? obj.sellerId;
    const id =
      typeof raw === "number"
        ? String(raw)
        : typeof raw === "string" && /^\d+$/.test(raw)
          ? raw
          : "";
    if (id && !seen.has(id)) {
      seen.add(id);
      const name =
        (typeof obj.supplier === "string" && obj.supplier) ||
        (typeof obj.supplierName === "string" && obj.supplierName) ||
        undefined;
      out.push({ id, name });
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return out;
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

function isWbBlockedHtml(_html: string, text: string): boolean {
  return /подозрительная активность|ваш запрос похож на автоматическ|доступ ограничен|новая попытка через/i.test(
    text
  );
}

function looksLikeWbStorefront(text: string): boolean {
  return (
    text.length > 80 &&
    /корзина|войти|доставка|каталог|скидк|найти/i.test(text)
  );
}

type SupplierHit = { id: string; name?: string };

function attachCatalogCollector(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): { drain: () => SupplierHit[] } {
  const hits: SupplierHit[] = [];
  page.on(
    "response",
    (response: { url: () => string; json: () => Promise<unknown> }) => {
      const url = response.url();
      if (!/wb\.ru|wildberries\.ru/i.test(url)) return;
      if (
        !/search|catalog|card|recommend|seller|supplier|main|v\d+/i.test(url)
      ) {
        return;
      }
      void response
        .json()
        .then((json) => {
          hits.push(...collectSupplierIds(json));
        })
        .catch(() => undefined);
    }
  );
  return {
    drain: () => {
      const unique = new Map<string, SupplierHit>();
      for (const hit of hits) unique.set(hit.id, hit);
      hits.length = 0;
      return [...unique.values()];
    },
  };
}

export type WbScanOptions = {
  startPage?: number;
  maxPages?: number;
  maxSellers?: number;
  skipSellerIds?: Iterable<string>;
  delayMs?: number;
  onPage?: (page: WbCatalogPage) => void;
  onSeller?: (card: WbSellerCard) => void;
};

export type WbScanResult = {
  pagesFetched: number;
  sellers: WbSellerCard[];
  declarations: FsaDeclaration[];
  nextPage: number;
  hasMore: boolean;
  skippedKnown: number;
};

function resolveWbProxy(): string | undefined {
  const explicit = process.env.OUTREACH_WB_PROXY?.trim();
  if (explicit) return explicit;
  // Как checko: на проде общий OUTREACH_FSA_PROXY; на localhost getFsaProxy() = undefined.
  return getFsaProxy();
}

async function openWbContext(headed: boolean): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any;
}> {
  const browsersPath = ensurePlaywrightBrowsersEnv();
  const { chromium } = await import("playwright");
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const executablePath = resolveChromePath(browsersPath);
  const channel =
    process.env.OUTREACH_WB_CHANNEL?.trim() ||
    (process.platform === "win32" ? "chrome" : undefined);
  if (!executablePath && !channel) {
    throw new Error("Не найден браузер для загрузки карточек продавцов.");
  }
  const proxy = resolveWbProxy();
  const launch = async (useChannel?: string, exe?: string) => {
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: !headed,
      executablePath: useChannel ? undefined : exe,
      channel: useChannel || undefined,
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled"],
      userAgent: USER_AGENT,
      viewport: { width: 1365, height: 900 },
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      ...(proxy ? { proxy: playwrightProxyOptions(proxy) } : {}),
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });
    const page = context.pages()[0] || (await context.newPage());
    return { context, page };
  };
  try {
    return await launch(channel, channel ? undefined : executablePath);
  } catch (error) {
    if (!channel || !executablePath) throw error;
    return launch(undefined, executablePath);
  }
}

async function waitWbReady(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  timeoutMs = 90_000
): Promise<void> {
  const started = Date.now();
  let blockedHits = 0;
  while (Date.now() - started < timeoutMs) {
    const html = await page.content().catch(() => "");
    const text = await page.locator("body").innerText().catch(() => "");
    if (isWbBlockedHtml(html, text)) {
      blockedHits += 1;
      if (blockedHits >= 3) {
        throw new Error(
          "Сайт не пускает к карточкам продавцов. Подождите и попробуйте снова."
        );
      }
      await sleep(3000);
      continue;
    }
    if (looksLikeWbStorefront(text) || html.length > 8000) {
      return;
    }
    await sleep(1500);
  }
  throw new Error(
    "Сайт не пускает к карточкам продавцов. Подождите и попробуйте снова."
  );
}

async function sellerIdsFromDom(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): Promise<SupplierHit[]> {
  const hrefs: string[] = await page
    .locator('a[href*="/seller/"]')
    .evaluateAll((nodes: { getAttribute: (name: string) => string | null }[]) =>
      nodes
        .map((node) => node.getAttribute("href") || "")
        .filter(Boolean)
    )
    .catch(() => []);
  const hits: SupplierHit[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    const id = href.match(/\/seller\/(\d+)/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    hits.push({ id });
  }
  return hits;
}

async function openSellerCard(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  sellerId: string
): Promise<WbSellerCard> {
  const url = `${WB_BASE}/seller/${sellerId}`;
  // Holder so TS does not narrow across the response callback assignment.
  const captured: { json: WbSupplierJson | null } = { json: null };
  const onResponse = (response: {
    url: () => string;
    json: () => Promise<unknown>;
  }) => {
    if (!/supplier-by-id\/\d+\.json/i.test(response.url())) return;
    void response
      .json()
      .then((json) => {
        captured.json = json as WbSupplierJson;
      })
      .catch(() => undefined);
  };
  page.on("response", onResponse);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitWbReady(page, 60_000);

    const infoBtn = page
      .locator(
        'button:has-text("Информация"), button:has-text("О продавце"), a:has-text("Информация о продавце"), a:has-text("Данные продавца")'
      )
      .first();
    if (await infoBtn.count()) {
      await infoBtn.click({ timeout: 4000 }).catch(() => undefined);
      await sleep(1200);
    }

    if (!captured.json?.inn) {
      captured.json =
        (await page
          .evaluate(async (id: string) => {
            const hosts = [
              "static-basket-01.wbbasket.ru",
              "static-basket-02.wbbasket.ru",
              "static-basket-03.wbbasket.ru",
            ];
            for (const host of hosts) {
              try {
                const res = await fetch(
                  `https://${host}/vol0/data/supplier-by-id/${id}.json`
                );
                if (!res.ok) continue;
                return await res.json();
              } catch {
                /* next */
              }
            }
            return null;
          }, sellerId)
          .catch(() => null)) || (await fetchWbSupplierJson(sellerId));
    }

    const html = await page.content();
    const text = await page.locator("body").innerText().catch(() => "");
    return applyWbSupplierJson(
      parseWbSellerHtml(html, sellerId, text),
      captured.json
    );
  } finally {
    page.off("response", onResponse);
  }
}

async function sellerIdFromFirstProduct(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): Promise<string | null> {
  const product = page
    .locator(
      'a[href*="/catalog/"][href*="/detail.aspx"], a[href*="/catalog/"][href*="detail"]'
    )
    .first();
  if (!(await product.count().catch(() => 0))) return null;
  await product.click({ timeout: 8000 }).catch(() => undefined);
  await waitWbReady(page, 45_000);
  await sleep(1500);
  const html = await page.content().catch(() => "");
  const text = await page.locator("body").innerText().catch(() => "");
  const fromLink = await sellerIdsFromDom(page);
  if (fromLink[0]?.id) return fromLink[0].id;
  const fromHtml =
    html.match(/\/seller\/(\d+)/)?.[1] ||
    html.match(/"supplierId"\s*:\s*(\d+)/)?.[1] ||
    text.match(/\/seller\/(\d+)/)?.[1];
  return fromHtml || null;
}

/** Главная WB: скролл ленты и сбор sellerId (без поиска). */
async function collectSellersFromHome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  collector: { drain: () => SupplierHit[] },
  scrollRounds = 4
): Promise<SupplierHit[]> {
  await page.goto(WB_BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitWbReady(page, 90_000);
  await page
    .locator(
      '.product-card, [data-nm-id], article.product-card, a[href*="/catalog/"]'
    )
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined);
  await sleep(1500);

  const merged = new Map<string, SupplierHit>();
  const rounds = Math.min(Math.max(scrollRounds, 1), 20);
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 1800).catch(() => undefined);
    await sleep(900 + Math.floor(Math.random() * 400));
    for (const hit of [...collector.drain(), ...(await sellerIdsFromDom(page))]) {
      merged.set(hit.id, hit);
    }
  }

  if (merged.size === 0) {
    const fromProduct = await sellerIdFromFirstProduct(page);
    if (fromProduct) merged.set(fromProduct, { id: fromProduct });
  }
  return [...merged.values()];
}

async function scanWbSellersUnlocked(
  options: WbScanOptions = {}
): Promise<WbScanResult> {
  const maxSellers = Math.min(Math.max(options.maxSellers ?? 50, 1), 300);
  const scrollRounds = Math.min(Math.max(options.maxPages ?? 8, 1), 20);
  const delayMs = wbListDelayMs(options.delayMs);
  const pass = Math.max(options.startPage ?? 1, 1);
  const skip = new Set(
    [...(options.skipSellerIds ?? [])].map((id) => String(id))
  );
  const seenStore = readWbSeenStore();
  for (const id of Object.keys(seenStore.bySellerId)) skip.add(id);

  const headed = process.env.OUTREACH_WB_HEADED === "1";
  const { context, page } = await openWbContext(headed);
  const sellers: WbSellerCard[] = [];
  let skippedKnown = 0;

  try {
    const collector = attachCatalogCollector(page);
    const hits = await collectSellersFromHome(page, collector, scrollRounds);
    const names: Record<string, string> = {};
    for (const hit of hits) {
      if (hit.name) names[hit.id] = hit.name;
    }
    const list: WbCatalogPage = {
      page: pass,
      sellerIds: hits.map((h) => h.id),
      names,
      hasMore: hits.length > 0,
    };
    options.onPage?.(list);

    for (const sellerId of list.sellerIds) {
      if (sellers.length >= maxSellers) break;
      if (skip.has(sellerId)) {
        skippedKnown += 1;
        continue;
      }
      skip.add(sellerId);
      if (delayMs) await sleep(delayMs + Math.floor(Math.random() * 400));
      try {
        const card = await openSellerCard(page, sellerId);
        if (!card.name && names[sellerId]) card.name = names[sellerId];
        rememberWbSeller({
          sellerId: card.sellerId,
          inn: card.inn,
          name: card.name || card.legalName,
          email: card.email,
          emailSource: card.email ? "wb" : undefined,
          searchedWbAt: todayIso(),
        });
        sellers.push(card);
        options.onSeller?.(card);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/не пускает|подозрительн/i.test(msg)) throw error;
      }
    }
  } finally {
    await context.close().catch(() => undefined);
  }

  return {
    pagesFetched: 1,
    sellers,
    declarations: sellers.map(wbSellerToDeclaration),
    nextPage: pass + 1,
    // Главная ротируется — следующий cron снова пройдёт ленту.
    hasMore: true,
    skippedKnown,
  };
}

export async function scanWbSellers(
  options: WbScanOptions = {}
): Promise<WbScanResult> {
  return withCheckoProfileLock(() => scanWbSellersUnlocked(options), {
    label: "wb-scan",
    waitMs: 180_000,
    lockPath: PROFILE_LOCK,
  });
}

/** Одна карточка с главной WB для ручной проверки (в очередь не кладём). */
export async function probeOneWbSeller(): Promise<WbSellerCard> {
  return withCheckoProfileLock(
    async () => {
      const headed = process.env.OUTREACH_WB_HEADED === "1";
      const { context, page } = await openWbContext(headed);
      try {
        const collector = attachCatalogCollector(page);
        const hits = await collectSellersFromHome(page, collector, 3);
        const sellerId = hits[0]?.id;
        if (!sellerId) {
          throw new Error(
            "На главной не нашли продавца. Подождите и попробуйте снова."
          );
        }
        const card = await openSellerCard(page, sellerId);
        if (!card.name && hits[0]?.name) card.name = hits[0].name;
        rememberWbSeller({
          sellerId: card.sellerId,
          inn: card.inn,
          name: card.name || card.legalName,
          email: card.email,
          emailSource: card.email ? "wb" : undefined,
          searchedWbAt: todayIso(),
        });
        return card;
      } finally {
        await context.close().catch(() => undefined);
      }
    },
    {
      label: "wb-one",
      waitMs: 180_000,
      lockPath: PROFILE_LOCK,
    }
  );
}

export type WbAccessProbe = {
  ok: boolean;
  error?: string;
};

/** Короткая проверка: открываем главную WB тем же Playwright-профилем. */
export async function probeWbAccess(): Promise<WbAccessProbe> {
  try {
    return await withCheckoProfileLock(
      async () => {
        const headed = process.env.OUTREACH_WB_HEADED === "1";
        const { context, page } = await openWbContext(headed);
        try {
          await page.goto(WB_BASE, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          await waitWbReady(page, 45_000);
          return { ok: true };
        } finally {
          await context.close().catch(() => undefined);
        }
      },
      {
        label: "wb-probe",
        waitMs: 90_000,
        lockPath: PROFILE_LOCK,
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/не пускает|подозрительн|access|lock/i.test(msg)) {
      return {
        ok: false,
        error:
          "Сайт сейчас не пускает. Подождите и попробуйте снова.",
      };
    }
    return {
      ok: false,
      error: "Нет связи с Wildberries. Проверьте соединение и попробуйте снова.",
    };
  }
}
