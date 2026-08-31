/**
 * Проверка фильтра статусов ФСА (offline).
 *   npx tsx scripts/verify-fsa-status.ts
 */
import assert from "node:assert/strict";
import {
  FSA_ACTIVE_STATUS_ID,
  isFsaDocumentActive,
  statusFromFsaRecord,
} from "../src/lib/outreach/fsa-status";

assert.equal(FSA_ACTIVE_STATUS_ID, 6);

assert.equal(
  statusFromFsaRecord({
    idStatus: 6,
    status: { idStatus: 6, status_name: "Действует" },
  }).status,
  "Действует"
);

assert.equal(
  statusFromFsaRecord({ idStatus: 14, statusName: "Приостановлен" }).status,
  "Приостановлен"
);

assert.equal(isFsaDocumentActive({ idStatus: 6, status: "Действует" }), true);
assert.equal(
  isFsaDocumentActive({ idStatus: 14, status: "Приостановлен" }),
  false
);
assert.equal(
  isFsaDocumentActive({ status: "Приостановлен действие сертификата" }),
  false
);
assert.equal(isFsaDocumentActive({ status: "unknown" }), false);
assert.equal(isFsaDocumentActive({ status: "Прекращен" }), false);

console.log("verify-fsa-status ok");
