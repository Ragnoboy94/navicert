import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import {
  getFsaProxyList,
  isSocksProxy,
  socksConnect,
  shouldUseFsaProxy,
} from "./fsa-proxy-shared";
import { CHECKO_ADVANCED_PATH, CHECKO_BASE } from "./checko";
import {
  getCheckoBlockReason,
  isCheckoBlocked,
} from "./checko-guard";

const CHECKO_PROBE_URL = `${CHECKO_BASE}${CHECKO_ADVANCED_PATH}`;

function dispatcherForProxy(proxy: string) {
  if (isSocksProxy(proxy)) {
    return new Agent({
      connect: (options, callback) => {
        const host = options.hostname ?? options.host;
        const port = Number(options.port);
        if (!host || !Number.isFinite(port)) {
          callback(new Error("proxy connect failed"), null);
          return;
        }
        socksConnect(proxy, { host, port })
          .then((socket) => callback(null, socket))
          .catch((error) =>
            callback(error instanceof Error ? error : new Error(String(error)), null)
          );
      },
    });
  }
  return new ProxyAgent(proxy);
}

function looksBlocked(html: string): boolean {
  return (
    /подтвердите,\s*что\s*вы\s*человек/i.test(html) ||
    /большое\s*количество\s*запросов/i.test(html) ||
    /smart-captcha/i.test(html) ||
    /captcha/i.test(html)
  );
}

export type CheckoAccessProbe = {
  ok: boolean;
  error?: string;
};

export async function probeCheckoAccess(): Promise<CheckoAccessProbe> {
  if (isCheckoBlocked()) {
    return {
      ok: false,
      error: getCheckoBlockReason() || "Сайт временно недоступен. Попробуйте позже.",
    };
  }

  const explicit = process.env.OUTREACH_CHECKO_PROXY?.trim();
  const proxies = explicit
    ? [explicit]
    : shouldUseFsaProxy()
      ? getFsaProxyList()
      : [];
  const candidates = proxies.length > 0 ? proxies : [undefined];

  for (const proxy of candidates) {
    try {
      const response = await undiciFetch(CHECKO_PROBE_URL, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
        ...(proxy ? { dispatcher: dispatcherForProxy(proxy) as never } : {}),
      } as Parameters<typeof undiciFetch>[1]);

      const html = await response.text().catch(() => "");
      if (response.status === 429 || looksBlocked(html)) {
        return {
          ok: false,
          error: "Сайт сейчас не пускает. Подождите и попробуйте снова.",
        };
      }
      if (response.ok) {
        return { ok: true };
      }
    } catch {
      /* try next */
    }
  }

  return {
    ok: false,
    error: "Нет связи с сайтом. Проверьте соединение и попробуйте снова.",
  };
}
