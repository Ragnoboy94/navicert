/**
 * Одно тестовое письмо актуального шаблона на OUTREACH_TEST_EMAIL.
 * Запуск: npx tsx scripts/outreach/send-one-test.mts
 * Опционально: CATEGORY=expiring_certificates | new_registrations
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  getTestCertificate,
  getTestDeclaration,
} from "../../src/lib/outreach/fsa";
import {
  getOutreachTestEmail,
  isOutreachTestMode,
  resolveOutreachSmtpAccount,
  sendOutreachEmail,
} from "../../src/lib/outreach/mailer";
import type { OutreachCategory } from "../../src/lib/outreach/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

process.env.OUTREACH_TEST_MODE = "true";

const raw = process.env.CATEGORY?.trim();
const category = (
  raw === "expiring_certificates"
    ? "expiring_certificates"
    : raw === "new_registrations"
      ? "new_registrations"
      : "expiring"
) as OutreachCategory;

async function main() {
  const declaration =
    category === "expiring_certificates"
      ? getTestCertificate()
      : getTestDeclaration();

  const smtp = resolveOutreachSmtpAccount(category);
  console.log({
    category,
    testMode: isOutreachTestMode(),
    to: getOutreachTestEmail(),
    from: smtp.from || smtp.user,
    company:
      declaration.applicant?.shortName || declaration.applicant?.fullName,
  });

  const result = await sendOutreachEmail(declaration, {
    force: true,
    manual: true,
    category,
    skipQueueRefresh: true,
  });

  console.log(result);
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
