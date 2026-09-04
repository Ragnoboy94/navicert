/**
 * Карточки продавцов Wildberries для 4-й рассылки.
 *
 * Почему не Playwright на www.wildberries.ru:
 * наш OUTREACH_FSA_PROXY пускает FSA/Checko, но CONNECT на wildberries.ru
 * даёт 502 → ERR_TUNNEL_CONNECTION_FAILED. Catalog/search API — 403.
 *
 * Рабочий путь через тот же прокси: CDN static-basket-*.wbbasket.ru
 * supplier-by-id/{id}.json (ИНН, юр. имя). Почта — через Checko по ИНН.
 *
 * Скан: идём по sellerId (курсор = apiCursor.page), тянем JSON через прокси.
 */

import fs from "node:fs";
import path from "node:path";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import type { FsaApplicant, FsaDeclaration } from "./types";
import {
  getFsaProxy,
  isSocksProxy,
  socksConnect,
} from "./fsa-proxy-shared";

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

const SKIP_EMAIL_HOSTS =
  /wildberries\.ru|wb\.ru|wbbasket\.ru|rwb\.ru|wbstatic\.net|captcha-support/i;

/** Один хост достаточно: vol0 реплицируется; 404 = id нет у всех. */
const SUPPLIER_HOSTS = [
  "static-basket-01.wbbasket.ru",
  "static-basket-02.wbbasket.ru",
  "static-basket-03.wbbasket.ru",
];

/** Верхняя граница перебора sellerId (можно поднять env). */
const WB_SELLER_ID_MAX = Math.max(
  Number(process.env.OUTREACH_WB_SELLER_ID_MAX || 5_000_000),
  10_000
);

let cachedProxyAgent: { key: string; agent: ProxyAgent } | null = null;

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

export type WbScanOptions = {
  /** Курсор: следующий sellerId для проверки (в очереди = apiCursor.page). */
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function wbListDelayMs(override?: number): number {
  if (override != null) return Math.max(override, 0);
  return Math.min(
    Math.max(Number(process.env.OUTREACH_WB_DELAY_MS || 400), 0),
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
      bySellerId:
        raw.bySellerId && typeof raw.bySellerId === "object"
          ? raw.bySellerId
          : {},
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
    inn: patch.inn ?? prev?.inn,
    name: patch.name ?? prev?.name,
    email: patch.email ?? prev?.email,
    emailSource: patch.emailSource ?? prev?.emailSource,
    searchedWbAt: patch.searchedWbAt ?? prev?.searchedWbAt ?? todayIso(),
    searchedCheckoAt: patch.searchedCheckoAt ?? prev?.searchedCheckoAt,
  };
  store.bySellerId[patch.sellerId] = next;
  if (next.inn) store.byInn[next.inn] = patch.sellerId;
  writeWbSeenStore(store);
  return next;
}

export function wasWbInnSearchedOnChecko(inn: string): boolean {
  const store = readWbSeenStore();
  const sellerId = store.byInn[inn];
  if (!sellerId) return false;
  return Boolean(store.bySellerId[sellerId]?.searchedCheckoAt);
}

const BAD_SELLER_NAMES = /^(все товары|каталог|wildberries|wb)$/i;

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
    name: shortName || fullName || trademark || card.name,
    legalName: fullName || shortName || card.legalName,
    inn,
    ogrn,
    email: emails[0] || card.email,
    emails,
  };
}

/**
 * Прокси для WB.
 * OUTREACH_WB_PROXY → иначе getFsaProxy() (прод: FSA-прокси, localhost: direct).
 */
export function resolveWbProxy(): string | undefined {
  const explicit = process.env.OUTREACH_WB_PROXY?.trim();
  if (explicit) return explicit;
  return getFsaProxy();
}

function wbProxyDispatcher(proxy: string) {
  if (isSocksProxy(proxy)) {
    return new Agent({
      connect: (options, callback) => {
        const host = options.hostname ?? options.host;
        const port = Number(options.port);
        if (!host || !Number.isFinite(port)) {
          callback(new Error("WB proxy connect failed"), null);
          return;
        }
        socksConnect(proxy, { host, port })
          .then((socket) => callback(null, socket))
          .catch((error) =>
            callback(
              error instanceof Error ? error : new Error(String(error)),
              null
            )
          );
      },
    });
  }
  if (cachedProxyAgent?.key === proxy) return cachedProxyAgent.agent;
  const agent = new ProxyAgent(proxy);
  cachedProxyAgent = { key: proxy, agent };
  return agent;
}

async function wbHttpFetch(
  url: string,
  init: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const proxy = resolveWbProxy();
  if (!proxy) {
    const res = await fetch(url, {
      headers: init.headers,
      signal: init.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
    };
  }
  const res = await undiciFetch(url, {
    method: "GET",
    headers: init.headers,
    signal: init.signal,
    dispatcher: wbProxyDispatcher(proxy) as never,
  } as Parameters<typeof undiciFetch>[1]);
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json(),
  };
}

export async function fetchWbSupplierJson(
  sellerId: string
): Promise<WbSupplierJson | null> {
  for (const host of SUPPLIER_HOSTS) {
    const url = `https://${host}/vol0/data/supplier-by-id/${sellerId}.json`;
    try {
      const res = await wbHttpFetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(8_000),
      });
      // 404 = id нет в реестре, другие зеркала те же.
      if (res.status === 404) return null;
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

export async function loadWbSellerCard(
  sellerId: string
): Promise<WbSellerCard | null> {
  const id = String(sellerId).replace(/\D/g, "");
  if (!id) return null;
  const json = await fetchWbSupplierJson(id);
  if (!json) return null;
  const card = applyWbSupplierJson(
    {
      sellerId: id,
      url: `${WB_BASE}/seller/${id}`,
      emails: [],
    },
    json
  );
  // Без ИНН дальше только Checko бесполезен — не тащим в очередь.
  if (!card.inn) return null;
  return card;
}

export async function scanWbSellers(
  options: WbScanOptions = {}
): Promise<WbScanResult> {
  const maxSellers = Math.min(Math.max(options.maxSellers ?? 50, 1), 300);
  const delayMs = wbListDelayMs(options.delayMs);
  let id = Math.max(options.startPage ?? 1, 1);
  const skip = new Set(
    [...(options.skipSellerIds ?? [])].map((x) => String(x))
  );
  const store = readWbSeenStore();
  for (const known of Object.keys(store.bySellerId)) skip.add(known);

  const sellers: WbSellerCard[] = [];
  let skippedKnown = 0;
  let attempts = 0;
  let storeDirty = false;
  const maxAttempts = Math.min(
    Math.max(maxSellers * 8, maxSellers + 20),
    Number(process.env.OUTREACH_WB_MAX_ATTEMPTS || 2000)
  );
  const foundIds: string[] = [];
  const names: Record<string, string> = {};

  while (
    sellers.length < maxSellers &&
    attempts < maxAttempts &&
    id <= WB_SELLER_ID_MAX
  ) {
    const sellerId = String(id);
    id += 1;

    if (skip.has(sellerId)) {
      skippedKnown += 1;
      continue;
    }
    skip.add(sellerId);
    attempts += 1;

    if (delayMs) await sleep(delayMs);

    try {
      const card = await loadWbSellerCard(sellerId);
      if (!card?.inn) continue;

      const prev = store.bySellerId[card.sellerId];
      store.bySellerId[card.sellerId] = {
        sellerId: card.sellerId,
        inn: card.inn,
        name: card.name || card.legalName,
        email: card.email,
        emailSource: card.email ? "wb" : undefined,
        searchedWbAt: todayIso(),
        searchedCheckoAt: prev?.searchedCheckoAt,
      };
      store.byInn[card.inn] = card.sellerId;
      storeDirty = true;

      sellers.push(card);
      foundIds.push(card.sellerId);
      if (card.name || card.legalName) {
        names[card.sellerId] = card.name || card.legalName || "";
      }
      options.onSeller?.(card);
    } catch {
      /* следующий id */
    }
  }

  if (storeDirty) writeWbSeenStore(store);

  const list: WbCatalogPage = {
    page: Math.max(options.startPage ?? 1, 1),
    sellerIds: foundIds,
    names,
    hasMore: id <= WB_SELLER_ID_MAX,
  };
  options.onPage?.(list);

  return {
    pagesFetched: attempts,
    sellers,
    declarations: sellers.map(wbSellerToDeclaration),
    nextPage: id,
    hasMore: id <= WB_SELLER_ID_MAX,
    skippedKnown,
  };
}

/** Одна карточка продавца для ручной проверки. */
export async function probeOneWbSeller(): Promise<WbSellerCard> {
  const seen = readWbSeenStore();
  const skip = new Set(Object.keys(seen.bySellerId));
  let id =
    8_000 +
    Math.floor(Math.random() * 120_000) +
    Math.floor(Date.now() / 1000) % 10_000;
  for (let i = 0; i < 80; i++) {
    const sellerId = String(id + i);
    if (skip.has(sellerId)) continue;
    const card = await loadWbSellerCard(sellerId);
    if (!card?.inn) continue;
    rememberWbSeller({
      sellerId: card.sellerId,
      inn: card.inn,
      name: card.name || card.legalName,
      email: card.email,
      emailSource: card.email ? "wb" : undefined,
      searchedWbAt: todayIso(),
    });
    return card;
  }
  throw new Error(
    "Не удалось загрузить карточку продавца. Проверьте прокси и попробуйте снова."
  );
}

export type WbAccessProbe = {
  ok: boolean;
  error?: string;
};

/** Проверка доступа к реестру продавцов WB через прокси. */
export async function probeWbAccess(): Promise<WbAccessProbe> {
  try {
    const proxy = resolveWbProxy();
    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
    const isLocal = /localhost|127\.0\.0\.1/i.test(site);
    if (!proxy && !isLocal) {
      return {
        ok: false,
        error:
          "Не задан прокси для Wildberries. Проверьте OUTREACH_FSA_PROXY на сервере.",
      };
    }

    const json = await fetchWbSupplierJson("12345");
    if (json?.inn || json?.supplierFullName) {
      return { ok: true };
    }
    return {
      ok: false,
      error:
        "Нет связи с Wildberries. Проверьте прокси и попробуйте снова.",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (process.env.OUTREACH_WB_DEBUG === "1") {
      return { ok: false, error: msg };
    }
    return {
      ok: false,
      error: "Нет связи с Wildberries. Проверьте соединение и попробуйте снова.",
    };
  }
}
