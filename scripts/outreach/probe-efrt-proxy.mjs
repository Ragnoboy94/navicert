#!/usr/bin/env node
/** Probe work EFRT proxies with auth against FSA. */
import { ProxyAgent } from "undici";

const HOSTS = [
  "95.215.1.123",
  "95.215.0.123",
  "46.161.51.145",
  "46.161.50.132",
  "46.161.51.166",
];

const USER = process.env.EFRT_PROXY_USERNAME || "etour";
const PASS = process.env.EFRT_PROXY_PASSWORD || "";
const PORT = process.env.EFRT_PROXY_PORT || "8080";
const FSA = "https://pub.fsa.gov.ru/rds/declaration";

function proxyUrl(host) {
  const user = encodeURIComponent(USER);
  const pass = encodeURIComponent(PASS);
  return `http://${user}:${pass}@${host}:${PORT}`;
}

async function tryProxy(host) {
  const url = proxyUrl(host);
  const started = Date.now();
  try {
    const agent = new ProxyAgent(url);
    const res = await fetch(FSA, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      dispatcher: agent,
    });
    const ok = res.ok || [301, 302].includes(res.status);
    return { host, ok, status: res.status, ms: Date.now() - started, proxy: url };
  } catch (error) {
    return {
      host,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      err: error instanceof Error ? error.message : String(error),
    };
  }
}

if (!PASS) {
  console.error("Set EFRT_PROXY_PASSWORD");
  process.exit(1);
}

const results = await Promise.all(HOSTS.map(tryProxy));
for (const r of results) {
  if (r.ok) {
    console.error(`OK ${r.host} -> ${r.status} (${r.ms}ms)`);
  } else {
    console.error(
      `FAIL ${r.host} -> ${r.status || r.err} (${r.ms}ms)`
    );
  }
}

const winners = results.filter((r) => r.ok);
if (!winners.length) {
  console.log(JSON.stringify({ winner: false, results }));
  process.exit(1);
}

const value = winners.map((w) => w.proxy).join(",");
console.log(
  JSON.stringify({
    winner: true,
    proxy: value,
    host: winners[0].host,
    status: winners[0].status,
  })
);
