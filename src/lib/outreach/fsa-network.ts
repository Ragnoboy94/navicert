import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import {
  getFsaProxyList,
  isSocksProxy,
  rememberWorkingFsaProxy,
  socksConnect,
} from "./fsa-proxy-shared";

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
      rememberWorkingFsaProxy("");
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All FSA proxies failed");
}
