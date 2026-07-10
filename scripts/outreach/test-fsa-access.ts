#!/usr/bin/env tsx
/**
 * Проверка доступа к pub.fsa.gov.ru.
 * Локально (РФ): direct. Прод (VPS за рубежом): через OUTREACH_FSA_PROXY.
 * Использует тот же fsaFetch, что и приложение.
 */
import { config } from "dotenv";
import path from "path";
import { fsaFetch, getFsaProxyList } from "../../src/lib/outreach/fsa-network";

config({ path: path.join(process.cwd(), ".env.local") });

const FSA_URL = "https://pub.fsa.gov.ru/rds/declaration";

async function probe(label: string, fetchImpl: typeof fetch) {
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

const proxies = getFsaProxyList();
console.log("OUTREACH_FSA_PROXY:", proxies[0]?.replace(/:[^:@]+@/, ":***@") || "(not set)");

async function main() {
  await probe("direct", fetch);
  if (proxies.length > 0) {
    await probe("via proxy (fsaFetch)", fsaFetch);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
