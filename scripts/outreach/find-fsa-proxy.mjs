#!/usr/bin/env node
/** Find working RU proxies for FSA; print comma-separated list for OUTREACH_FSA_PROXY. */
import { ProxyAgent } from "undici";

const FSA = "https://pub.fsa.gov.ru/rds/declaration";
/** proxy5.net RU snapshot — tried first when page fetch is slow */
const PRIORITY = [
  "http://185.148.105.13:80",
  "http://45.67.215.231:80",
  "http://31.12.75.183:80",
  "http://45.67.215.105:80",
  "http://45.67.215.31:80",
  "http://109.234.159.83:80",
  "http://146.185.235.147:8080",
  "http://95.213.206.11:8009",
  "http://51.250.44.119:80",
  "http://158.160.87.155:8080",
  "http://87.236.21.86:80",
  "http://37.228.116.103:80",
  "http://193.188.23.78:80",
  "http://109.70.24.168:443",
  "http://149.154.69.59:80",
];
const SOURCES = [
  "https://proxy5.net/free-proxy/russia",
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=RU&ssl=yes&anonymity=all",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
];

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; NavicertFSA/1.0; +https://navicert.pro)",
    },
  });
  return res.text();
}

function parseHosts(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/g)) {
    const ip = m[1];
    const port = m[2];
    if (ip.startsWith("0.") || ip.startsWith("127.")) continue;
    found.add(`${ip}:${port}`);
  }
  // proxy5.net table: | 149.154.69.59 | 80 | HTTP | ...
  for (const m of text.matchAll(
    /\|\s*(\d{1,3}(?:\.\d{1,3}){3})\s*\|\s*(\d{2,5})\s*\|\s*(HTTP|HTTPS|SOCKS5)/gi
  )) {
    const ip = m[1];
    const port = m[2];
    const proto = m[3].toUpperCase();
    if (ip.startsWith("0.") || ip.startsWith("127.")) continue;
    if (proto === "SOCKS5") found.add(`socks5://${ip}:${port}`);
    else found.add(`http://${ip}:${port}`);
  }
  return [...found];
}

async function testProxy(proxyUrl) {
  const started = Date.now();
  try {
    const agent = new ProxyAgent(proxyUrl);
    const res = await fetch(FSA, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      dispatcher: agent,
    });
    const ok = res.ok || [301, 302].includes(res.status);
    return { proxyUrl, ok, status: res.status, ms: Date.now() - started };
  } catch (error) {
    return {
      proxyUrl,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      err: error instanceof Error ? error.message : String(error),
    };
  }
}

const all = new Set(PRIORITY);
for (const src of SOURCES) {
  try {
    const text = await fetchText(src);
    for (const h of parseHosts(text)) all.add(h);
    console.error(`source ${src}: +${parseHosts(text).length} proxies`);
  } catch (e) {
    console.error(`source ${src} failed:`, e instanceof Error ? e.message : e);
  }
}

const list = [...all];
// proxy5 RU HTTP first, then the rest
list.sort((a, b) => {
  const score = (p) =>
    (p.startsWith("http://") ? 0 : 1) +
    (p.includes("149.154.") || p.includes("109.234.") ? -1 : 0);
  return score(a) - score(b);
});
const toTest = list.slice(0, 250);
console.error(`testing ${toTest.length} proxies against FSA...`);

const winners = [];
const batchSize = 12;
for (let i = 0; i < toTest.length && winners.length < 5; i += batchSize) {
  const batch = toTest.slice(i, i + batchSize);
  const results = await Promise.all(batch.map((proxyUrl) => testProxy(proxyUrl)));
  for (const r of results) {
    if (r.ok) {
      winners.push(r.proxyUrl);
      console.error(`OK ${r.proxyUrl} -> ${r.status} (${r.ms}ms)`);
    } else if (r.status > 0) {
      console.error(`${r.proxyUrl} -> ${r.status}`);
    }
  }
}

if (winners.length === 0) {
  console.log(JSON.stringify({ winner: false, tested: list.length }));
  process.exit(1);
}

const value = winners.join(",");
console.log(JSON.stringify({ winner: true, proxy: value, count: winners.length }));
process.exit(0);
