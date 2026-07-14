import { SocksClient, type SocksProxy } from "socks";

/** Keep in sync with scripts/outreach/fsa-proxy-shared.mjs
 *  OUTREACH_FSA_PROXY: required on prod VPS; omit when running locally in Russia. */

let cachedWorkingProxy: string | undefined;

export function parseFsaProxyUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty proxy URL");
  return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
}

export function isSocksProxy(proxy: string): boolean {
  const protocol = parseFsaProxyUrl(proxy).protocol;
  return protocol === "socks5:" || protocol === "socks4:";
}

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
  cachedWorkingProxy = proxy.trim() || undefined;
}

export function toSocksProxy(proxy: string): SocksProxy {
  const url = parseFsaProxyUrl(proxy);
  const type = url.protocol === "socks4:" ? 4 : 5;
  return {
    host: url.hostname,
    port: Number(url.port || "1080"),
    type,
    ...(url.username
      ? {
          userId: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        }
      : {}),
  };
}

export function playwrightProxyOptions(proxy: string): {
  server: string;
  username?: string;
  password?: string;
} {
  const url = parseFsaProxyUrl(proxy);
  if (url.protocol === "http:" || url.protocol === "https:") {
    const server = `${url.protocol}//${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
    if (url.username) {
      return {
        server,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    }
    return { server: proxy };
  }
  if (url.protocol.startsWith("socks")) {
    return {
      server: `${url.protocol}//${url.hostname}:${url.port || "1080"}`,
      ...(url.username
        ? {
            username: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
          }
        : {}),
    };
  }
  return { server: proxy };
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

export async function socksConnect(
  proxyRaw: string,
  destination: { host: string; port: number }
) {
  const { socket } = await SocksClient.createConnection({
    proxy: toSocksProxy(proxyRaw),
    command: "connect",
    destination,
  });
  return socket;
}
