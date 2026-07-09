import { ProxyAgent } from "undici";

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

export async function fsaFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const proxies = getFsaProxyList();
  if (proxies.length === 0) return fetch(url, init);

  let lastError: unknown;
  for (const proxy of proxies) {
    try {
      const response = await fetch(url, {
        ...init,
        // @ts-expect-error undici dispatcher for Node fetch
        dispatcher: new ProxyAgent(proxy),
      });
      rememberWorkingFsaProxy(proxy);
      return response;
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
  proxy?: { server: string };
} {
  const proxy = getFsaProxy();
  return {
    headless: true,
    ...(proxy ? { proxy: { server: proxy } } : {}),
  };
}
