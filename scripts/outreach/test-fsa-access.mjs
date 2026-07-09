#!/usr/bin/env node
/**
 * Проверка доступа к pub.fsa.gov.ru (прямой или через OUTREACH_FSA_PROXY).
 * Run: node scripts/outreach/test-fsa-access.mjs
 */
import { ProxyAgent } from "undici";
import { getFsaProxyUrl } from "./fsa-proxy.mjs";

const FSA_URL = "https://pub.fsa.gov.ru/rds/declaration";

async function probe(label, fetchImpl) {
  const started = Date.now();
  try {
    const response = await fetchImpl(FSA_URL, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
    const ms = Date.now() - started;
    console.log(`${label}: HTTP ${response.status} (${ms} ms)`);
    return response.ok;
  } catch (error) {
    const ms = Date.now() - started;
    console.log(
      `${label}: FAIL (${ms} ms) — ${error instanceof Error ? error.message : error}`
    );
    return false;
  }
}

const proxy = getFsaProxyUrl();
console.log("OUTREACH_FSA_PROXY:", proxy || "(not set)");

await probe("direct", fetch);

if (proxy) {
  const agent = new ProxyAgent(proxy);
  await probe("via proxy", (url, init) =>
    fetch(url, { ...init, dispatcher: agent })
  );
}
