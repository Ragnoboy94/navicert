import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import {
  getFsaProxyList,
  isSocksProxy,
  rememberWorkingFsaProxy,
  socksConnect,
} from "./fsa-proxy-shared";

const FSA_PROBE_URL = "https://pub.fsa.gov.ru/rds/declaration";

export type FsaTransportMode = "direct" | "proxy";

export type FsaTransportProbe = {
  ok: boolean;
  mode: FsaTransportMode;
  proxy?: string;
  error?: string;
};

function dispatcherForProxy(proxy: string) {
  if (isSocksProxy(proxy)) {
    return new Agent({
      connect: (options, callback) => {
        const host = options.hostname ?? options.host;
        const port = Number(options.port);
        if (!host || !Number.isFinite(port)) {
          callback(new Error("FSA proxy connect: missing host/port"), null);
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

export { getFsaProxyList, getFsaProxy, playwrightLaunchOptions } from "./fsa-proxy-shared";

const DEFAULT_FSA_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /timeout|timed out|abort|econnreset|econnrefused|enotfound|socket hang up|network|fetch failed|all fsa proxies failed/i.test(
      msg
    )
  );
}

async function probeWithFetch(
  fetchImpl: typeof fetch,
  label: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchImpl(FSA_PROBE_URL, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok || response.status < 500) {
      return { ok: true };
    }
    return { ok: false, error: `${label}: HTTP ${response.status}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${label}: ${msg}` };
  }
}

/** Проверка доступности pub.fsa.gov.ru — direct или через прокси. */
export async function probeFsaTransport(): Promise<FsaTransportProbe> {
  const proxies = getFsaProxyList();

  if (proxies.length === 0) {
    const direct = await probeWithFetch(fetch, "direct");
    return direct.ok
      ? { ok: true, mode: "direct" }
      : { ok: false, mode: "direct", error: direct.error };
  }

  let lastError = "Все прокси недоступны";
  for (const proxy of proxies) {
    try {
      const response = await undiciFetch(FSA_PROBE_URL, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
        dispatcher: dispatcherForProxy(proxy),
      } as Parameters<typeof undiciFetch>[1]);
      if (response.ok || response.status < 500) {
        rememberWorkingFsaProxy(proxy);
        return { ok: true, mode: "proxy", proxy };
      }
      lastError = `HTTP ${response.status} via proxy`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      rememberWorkingFsaProxy("");
    }
  }

  return { ok: false, mode: "proxy", error: lastError };
}

export async function fsaFetch(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FSA_TIMEOUT_MS;
  const retries = Math.max(options.retries ?? 2, 0);
  const proxies = getFsaProxyList();

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const attemptInit: RequestInit = {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    };

    try {
      if (proxies.length === 0) {
        return await fetch(url, attemptInit);
      }

      for (const proxy of proxies) {
        try {
          const response = await undiciFetch(url, {
            ...attemptInit,
            dispatcher: dispatcherForProxy(proxy),
          } as Parameters<typeof undiciFetch>[1]);
          rememberWorkingFsaProxy(proxy);
          return response as unknown as Response;
        } catch (error) {
          lastError = error;
          rememberWorkingFsaProxy("");
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error("All FSA proxies failed");
    } catch (error) {
      lastError = error;
      if (attempt < retries && isTransientNetworkError(error)) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("FSA fetch failed");
}
