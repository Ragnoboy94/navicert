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
  "ФСА недоступна: нет прокси"
);
assert.equal(formatFsaConnectionError(transportErr), transportErr.message);
ok("format preserves FsaConnectionError");

const tokenErr = new Error("FSA POST /api → 401: Unauthorized");
const formatted = formatFsaConnectionError(tokenErr);
assert.match(formatted, /сессия|токен|401/i);
ok("format maps 401 to token hint");

const netErr = new Error("fetch failed: ECONNRESET");
assert.match(formatFsaConnectionError(netErr), /соединени/i);
ok("format maps network errors");

console.log("\n--- fsa-connection offline ok ---\n");
