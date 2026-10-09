/**
 * Отправляет все варианты шаблона «Заканчивающиеся СС» на OUTREACH_TEST_EMAIL.
 * Берёт реальный сертификат: data/_test-expiring-certificate.json → очередь → getTestCertificate.
 * Запуск: npx tsx scripts/outreach/send-ss-template-variants.mts
 */
import { config as loadEnv } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getTestCertificate } from "../../src/lib/outreach/fsa";
import {
  getOutreachTestEmail,
  isOutreachTestMode,
  resolveOutreachSmtpAccount,
  sendOutreachEmail,
} from "../../src/lib/outreach/mailer";
import { readOutreachQueue } from "../../src/lib/outreach/queue";
import {
  CERTIFICATE_TEMPLATES,
  buildOutreachEmail,
} from "../../src/lib/outreach/template";
import type { FsaDeclaration } from "../../src/lib/outreach/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

process.env.OUTREACH_TEST_MODE = "true";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadRealCertificate(): { declaration: FsaDeclaration; source: string } {
  const snapshot = path.join(root, "data", "_test-expiring-certificate.json");
  if (fs.existsSync(snapshot)) {
    const raw = JSON.parse(fs.readFileSync(snapshot, "utf-8")) as FsaDeclaration;
    if (raw?.id && raw?.applicant?.email) {
      return { declaration: raw, source: snapshot };
    }
  }

  const queue = readOutreachQueue("expiring_certificates");
  const fromQueue = queue?.items?.find(
    (item) =>
      item.emailStatus === "eligible" &&
      item.applicant?.email &&
      item.productName &&
      item.endDate
  );
  if (fromQueue) {
    return {
      declaration: fromQueue,
      source: "data/outreach-certificates-queue.json",
    };
  }

  return { declaration: getTestCertificate(), source: "getTestCertificate()" };
}

async function main() {
  const { declaration, source } = loadRealCertificate();
  const smtp = resolveOutreachSmtpAccount("expiring_certificates");
  const to = getOutreachTestEmail();

  console.log({
    testMode: isOutreachTestMode(),
    to,
    from: smtp.from || smtp.user,
    source,
    id: declaration.id,
    company:
      declaration.applicant?.shortName || declaration.applicant?.fullName,
    realEmail: declaration.applicant?.email,
    endDate: declaration.endDate,
    product: declaration.productName,
    variants: CERTIFICATE_TEMPLATES.length,
  });

  for (let i = 0; i < CERTIFICATE_TEMPLATES.length; i++) {
    const preview = buildOutreachEmail(declaration, {
      category: "expiring_certificates",
      templateIndex: i,
      recipientEmail: to,
    });
    console.log(`\n[${i + 1}/${CERTIFICATE_TEMPLATES.length}] ${preview.templateId}`);
    console.log(`subject: ${preview.subject}`);

    const result = await sendOutreachEmail(declaration, {
      force: true,
      manual: true,
      category: "expiring_certificates",
      skipQueueRefresh: true,
      templateIndex: i,
    });
    console.log(result);
    if (!result.ok) process.exit(1);
    if (i < CERTIFICATE_TEMPLATES.length - 1) await sleep(2500);
  }

  console.log(`\nГотово: ${CERTIFICATE_TEMPLATES.length} писем → ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
