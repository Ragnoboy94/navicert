import { SocksClient, type SocksProxy } from "socks";

export function parseFsaProxyUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty proxy URL");
  return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
}

export function isSocksProxy(proxy: string): boolean {
  const protocol = parseFsaProxyUrl(proxy).protocol;
  return protocol === "socks5:" || protocol === "socks4:";
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
