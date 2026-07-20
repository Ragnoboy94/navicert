/**
 * Offline checks for email validation.
 * Run: npx tsx scripts/verify-email-validator.ts
 */
import assert from "node:assert/strict";
import { classifyEmail } from "../src/lib/outreach/email-filter";
import {
  detectDomainTypo,
  suggestEmailFix,
  validateEmailSyntax,
} from "../src/lib/outreach/email-validator";

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}

assert.equal(validateEmailSyntax("info@company.ru"), null);
ok("valid corporate syntax");

assert.equal(validateEmailSyntax("bad@"), "invalid_syntax");
assert.equal(validateEmailSyntax("a@b"), "invalid_syntax");
ok("invalid syntax");

assert.equal(detectDomainTypo("info@company.r"), "domain_typo_r");
assert.equal(suggestEmailFix("info@company.r"), "info@company.ru");
ok("typo .r → .ru");

const rejected = classifyEmail("info@company.r");
assert.equal(rejected.status, "rejected");
assert.equal(rejected.reason, "domain_typo_r");
ok("classifyEmail rejects typo");

const personal = classifyEmail("user@gmail.com");
assert.equal(personal.status, "rejected");
ok("personal still rejected");

const corp = classifyEmail("sales@zavod-metal.ru");
assert.equal(corp.status, "eligible");
ok("corporate eligible");

console.log("\n--- email-validator offline ok ---\n");
