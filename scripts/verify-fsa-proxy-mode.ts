/**
 * Проверка режимов ФСА-прокси (offline).
 * Run: npx tsx scripts/verify-fsa-proxy-mode.ts
 */
import assert from "node:assert/strict";
import {
  getFsaProxyList,
  shouldUseFsaProxy,
} from "../src/lib/outreach/fsa-proxy-shared";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    prev[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      const value = prev[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

withEnv(
  {
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    OUTREACH_FSA_PROXY: "http://user:pass@45.134.52.216:8000",
  },
  () => {
    assert.equal(shouldUseFsaProxy(), false);
    assert.deepEqual(getFsaProxyList(), []);
    console.log("  ✓ localhost ignores OUTREACH_FSA_PROXY");
  }
);

withEnv(
  {
    NEXT_PUBLIC_SITE_URL: "https://navicert.pro",
    OUTREACH_FSA_PROXY: "http://user:pass@45.134.52.216:8000",
  },
  () => {
    assert.equal(shouldUseFsaProxy(), true);
    assert.equal(getFsaProxyList().length, 1);
    console.log("  ✓ prod site uses OUTREACH_FSA_PROXY");
  }
);

withEnv(
  {
    NEXT_PUBLIC_SITE_URL: "https://navicert.pro",
    OUTREACH_FSA_PROXY: undefined,
  },
  () => {
    assert.equal(shouldUseFsaProxy(), false);
    assert.deepEqual(getFsaProxyList(), []);
    console.log("  ✓ prod site without proxy → direct list empty");
  }
);

console.log("\n--- fsa-proxy-mode ok ---\n");
