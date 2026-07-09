import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import {
  isSocksProxy,
  playwrightProxyOptions,
  socksConnect,
} from "./fsa-proxy-shared";

let cachedWorkingProxy: string | undefined;

function parseProxyList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean))];
}

export function getFsaProxyList(): string[] {
  const fromEnv =
    process.env.OUTREACH_FSA_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    "";
  const list = parseProxyList(fromEnv);
  if (cachedWorkingProxy && list.includes(cachedWorkingProxy)) {
    return [cachedWorkingProxy, ...list.filter((p) => p !== cachedWorkingProxy)];
  }
  return list;
}

export function getFsaProxy(): string | undefined {
  return getFsaProxyList()[0];
}

export function rememberWorkingFsaProxy(proxy: string): void {
  cachedWorkingProxy = proxy;
}

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

export async function fsaFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const proxies = getFsaProxyList();
  if (proxies.length === 0) return fetch(url, init);

  let lastError: unknown;
  for (const proxy of proxies) {
    try {
      const response = await undiciFetch(url, {
        ...init,
        dispatcher: dispatcherForProxy(proxy),
      } as Parameters<typeof undiciFetch>[1]);
      rememberWorkingFsaProxy(proxy);
      return response as unknown as Response;
    } catch (error) {
      lastError = error;
      cachedWorkingProxy = undefined;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All FSA proxies failed");
}

export function playwrightLaunchOptions(): {
  headless: boolean;
  proxy?: { server: string; username?: string; password?: string };
} {
  const proxy = getFsaProxy();
  return {
    headless: true,
    ...(proxy ? { proxy: playwrightProxyOptions(proxy) } : {}),
  };
}
