/**
 * Статический тест: сертификаты = RSS, декларации = RDS.
 * Без сети / без токена.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fsa = fs.readFileSync(path.join(root, "src/lib/outreach/fsa.ts"), "utf8");
const enrich = fs.readFileSync(
  path.join(root, "scripts/outreach/enrich-applicants.mjs"),
  "utf8"
);

assert.match(fsa, /\/api\/v1\/rss\/common\/certificates\/get/);
assert.match(fsa, /\/api\/v1\/rss\/common\/certificates\/\$\{id\}/);
assert.match(fsa, /refererPath:\s*"\/rss\/certificate"/);
assert.match(fsa, /\/rss\/certificate\/view\/\$\{id\}\/applicant/);
assert.doesNotMatch(fsa, /\/api\/v1\/rds\/common\/certificates/);
assert.doesNotMatch(fsa, /\/rds\/certificate/);

assert.match(fsa, /\/api\/v1\/rds\/common\/declarations\/get/);
assert.match(fsa, /\/rds\/declaration\/view/);

assert.match(enrich, /pub\.fsa\.gov\.ru\/rss\/certificate/);
assert.match(enrich, /apiNamespace = isCertificates \? "rss" : "rds"/);
assert.doesNotMatch(enrich, /pub\.fsa\.gov\.ru\/rds\/certificate/);

console.log(
  JSON.stringify(
    {
      ok: true,
      certificatesApi: "/api/v1/rss/common/certificates/get",
      certificatesUi: "/rss/certificate",
      declarationsApi: "/api/v1/rds/common/declarations/get",
      declarationsUi: "/rds/declaration",
    },
    null,
    2
  )
);
