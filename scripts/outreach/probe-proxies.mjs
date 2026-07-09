#!/usr/bin/env node
/** Probe proxy hosts/ports for FSA access. */
import { ProxyAgent } from "undici";

const HOSTS = [
  "95.215.1.123",
  "95.215.0.123",
  "46.161.51.145",
  "46.161.50.132",
  "46.161.51.166",
];

const PORTS = [8080, 3128, 1080, 8888, 80, 443, 9050, 8000, 8081];
const SCHEMES = ["http", "socks5"];
const FSA = "https://pub.fsa.gov.ru/rds/declaration";

async function tryProxy(url) {
  const started = Date.now();
  try {
    const agent = new ProxyAgent(url);
    const res = await fetch(FSA, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
      dispatcher: agent,
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      err: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log("Probing proxies for", FSA);
  for (const host of HOSTS) {
    for (const port of PORTS) {
      for (const scheme of SCHEMES) {
        const url = `${scheme}://${host}:${port}`;
        const result = await tryProxy(url);
        if (result.ok || result.status > 0) {
          console.log(
            `HIT ${url} -> ${result.status} (${result.ms}ms)${result.err ? " " + result.err : ""}`
          );
        }
      }
    }
  }
  console.log("done");
}

main();
