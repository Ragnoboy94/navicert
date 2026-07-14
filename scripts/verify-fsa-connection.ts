/**
 * Offline checks for FSA connection chain (no live FSA).
 * Run: npx tsx scripts/verify-fsa-connection.ts
 */
import assert from "node:assert/strict";
import {
  FsaConnectionError,
  formatFsaConnectionError,
  resetFsaTransportCache,
} from "../src/lib/outreach/fsa-connection";

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}

resetFsaTransportCache();

const transportErr = new FsaConnectionError(
  "transport",
  "ФСА недоступна: нет связи с реестром через прокси"
);
assert.equal(
  formatFsaConnectionError(transportErr),
  "ФСА недоступна: нет связи с реестром через прокси"
);
ok("format maps transport errors");

const tokenErr = new Error("FSA POST /api → 401: Unauthorized");
const formatted = formatFsaConnectionError(tokenErr);
assert.match(formatted, /сессия|токен/i);
ok("format maps 401 to token hint");

const netErr = new Error("fetch failed: ECONNRESET");
assert.match(formatFsaConnectionError(netErr), /связи|реестр/i);
ok("format maps network errors");

console.log("\n--- fsa-connection offline ok ---\n");
