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

export function playwrightLaunchOptions() {
  const proxy = getFsaProxyUrl();
  return {
    headless: true,
    ...(proxy ? { proxy: { server: proxy } } : {}),
  };
}
