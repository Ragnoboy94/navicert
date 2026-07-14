#!/usr/bin/env tsx
/**
 * Проверка доступа к pub.fsa.gov.ru.
 * Локально (РФ): direct. Прод (VPS за рубежом): через OUTREACH_FSA_PROXY.
 */
import { config } from "dotenv";
import path from "path";
import {
  fsaFetch,
  getFsaProxyList,
  probeFsaTransport,
  shouldUseFsaProxy,
} from "../../src/lib/outreach/fsa-network";
import {
  FsaConnectionError,
  formatFsaConnectionError,
} from "../../src/lib/outreach/fsa-connection";

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

async function main() {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "(unset)";
  const proxies = getFsaProxyList();
  console.log("SITE_URL:", site);
  console.log("shouldUseFsaProxy:", shouldUseFsaProxy());
  console.log(
    "proxy list:",
    proxies[0]?.replace(/:[^:@]+@/, ":***@") || "(empty → direct)"
  );

  const transport = await probeFsaTransport();
  console.log(
    "probeFsaTransport:",
    transport.ok
      ? `ok (${transport.mode}${transport.proxy ? ", proxy" : ""})`
      : `fail — ${transport.error}`
  );

  if (!transport.ok) {
    process.exitCode = 1;
    return;
  }

  await probe(transport.mode === "proxy" ? "via proxy (fsaFetch)" : "direct", fsaFetch);

  const sample = new FsaConnectionError("token", "test token error");
  console.log("formatFsaConnectionError:", formatFsaConnectionError(sample));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
