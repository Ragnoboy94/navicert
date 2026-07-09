let cachedWorkingProxy = "";

function parseProxyList(raw) {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean))];
}

export function getFsaProxyList() {
  const raw =
    process.env.OUTREACH_FSA_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    "";
  const list = parseProxyList(raw);
  if (cachedWorkingProxy && list.includes(cachedWorkingProxy)) {
    return [cachedWorkingProxy, ...list.filter((p) => p !== cachedWorkingProxy)];
  }
  return list;
}

export function getFsaProxyUrl() {
  return getFsaProxyList()[0] || "";
}

export function rememberWorkingFsaProxy(proxy) {
  cachedWorkingProxy = proxy;
}

function playwrightProxyOptions(proxy) {
  const url = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
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

export function playwrightLaunchOptions() {
  const proxy = getFsaProxyUrl();
  return {
    headless: true,
    ...(proxy ? { proxy: playwrightProxyOptions(proxy) } : {}),
  };
}
