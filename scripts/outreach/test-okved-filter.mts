/**
 * Офлайн-проверка матчера ОКВЭД для новых организаций.
 * Запуск: npx tsx scripts/outreach/test-okved-filter.mts
 */
import assert from "node:assert/strict";
import {
  extractOkvedCode,
  matchesAllowedOkved,
} from "../../src/lib/outreach/okved";
import { NEW_REG_OKVED_CODES } from "../../src/lib/outreach/new-reg-okved-data";

assert.equal(extractOkvedCode("14.13 — Производство прочей верхней одежды"), "14.13");
assert.equal(extractOkvedCode("14.13.1"), "14.13.1");
assert.equal(extractOkvedCode("Новая организация"), null);

assert.equal(matchesAllowedOkved("14.13 — x"), true);
assert.equal(matchesAllowedOkved("14.13.1 — дочерний"), true);
assert.equal(matchesAllowedOkved("14.12"), true);
assert.equal(matchesAllowedOkved("52.1 — Складирование"), false);
assert.equal(matchesAllowedOkved("14"), false);
assert.equal(matchesAllowedOkved(undefined), false);

assert.ok(NEW_REG_OKVED_CODES.includes("14.13"));
assert.equal(NEW_REG_OKVED_CODES.length, 114);

console.log("okved filter ok:", NEW_REG_OKVED_CODES.length, "codes");
