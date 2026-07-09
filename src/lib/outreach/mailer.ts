import fs from "fs";
import path from "path";
import { classifyEmail, isCorporateEmail } from "./email-filter";
import {
  createOutreachTransporter,
  outreachSmtpAttempts,
  smtpErrorReason,
} from "./smtp-transport";
import { buildOutreachEmail, getOutreachFromName } from "./template";
import type { FsaDeclaration, OutreachCategory, OutreachSendRecord } from "./types";
import { isUnsubscribed } from "./unsubscribe";

const DEFAULT_CATEGORY: OutreachCategory = "expiring";

const sentPath = path.join(process.cwd(), "data", "outreach-sent.json");

export function isOutreachTestMode(): boolean {
  return process.env.OUTREACH_TEST_MODE !== "false";
}

export function getOutreachTestEmail(): string {
  return process.env.OUTREACH_TEST_EMAIL?.trim() || "still-1994@mail.ru";
}

export { isCorporateEmail };

export function resolveRecipientEmail(
  declaration: FsaDeclaration
): string | null {
  const email = declaration.applicant?.email?.trim().toLowerCase();
  if (!email) return null;
  if (!isCorporateEmail(email)) return null;
  return email;
}

export function readSentRecords(): OutreachSendRecord[] {
  if (!fs.existsSync(sentPath)) return [];
  return JSON.parse(fs.readFileSync(sentPath, "utf-8")) as OutreachSendRecord[];
}

export function buildSentLookup(records = readSentRecords()) {
  const byDeclarationId = new Set(records.map((item) => item.declarationId));
  const byRecipient = new Set(
    records
      .map((item) => item.originalRecipient.trim().toLowerCase())
      .filter(Boolean)
  );
  return { byDeclarationId, byRecipient };
}

function writeSentRecord(record: OutreachSendRecord): void {
  const dir = path.dirname(sentPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const records = readSentRecords();
  records.push(record);
  fs.writeFileSync(sentPath, JSON.stringify(records, null, 2) + "\n");
}

export function wasAlreadySent(declarationId: number): boolean {
  return readSentRecords().some((item) => item.declarationId === declarationId);
}

export function wasAlreadySentToRecipient(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return readSentRecords().some(
    (item) => item.originalRecipient.trim().toLowerCase() === normalized
  );
}

export function getSendBlockReason(
  declaration: FsaDeclaration,
  options: {
    force?: boolean;
    manual?: boolean;
    category?: OutreachCategory;
  } = {}
): string | null {
  const category = options.category ?? DEFAULT_CATEGORY;
  if (options.force) return null;
  if (wasAlreadySent(declaration.id)) return "already_sent";

  const email =
    declaration.applicant?.email?.trim().toLowerCase() ||
    resolveRecipientEmail(declaration);
  if (email && wasAlreadySentToRecipient(email)) {
    return "recipient_already_sent";
  }
  if (email && isUnsubscribed(email, category)) {
    return "unsubscribed";
  }

  if (!options.manual) {
    const { status } = classifyEmail(declaration.applicant?.email);
    if (status !== "eligible") return "no_corporate_email";
  } else if (!declaration.applicant?.email?.trim()) {
    return "no_email";
  }

  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBatchDelayMs(rawValue: unknown): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return 3000;
  return Math.min(Math.max(parsed, 1000), 30000);
}

export async function sendOutreachEmail(
  declaration: FsaDeclaration,
  options: { force?: boolean; manual?: boolean } = {}
): Promise<{ ok: true; record: OutreachSendRecord } | { ok: false; reason: string }> {
  const blockReason = getSendBlockReason(declaration, options);
  if (blockReason) {
    return { ok: false, reason: blockReason };
  }

  const originalRecipient = (
    options.manual
      ? declaration.applicant?.email?.trim().toLowerCase()
      : resolveRecipientEmail(declaration)
  ) as string | null;

  if (!originalRecipient) {
    return { ok: false, reason: "no_corporate_email" };
  }

  const host =
    process.env.OUTREACH_SMTP_HOST?.trim() ||
    process.env.SMTP_HOST?.trim() ||
    "smtp.mail.ru";
  const user = process.env.OUTREACH_SMTP_USER?.trim() || process.env.SMTP_USER?.trim();
  const pass = process.env.OUTREACH_SMTP_PASS?.trim() || process.env.SMTP_PASS?.trim();
  if (!user || !pass) {
    return { ok: false, reason: "smtp_not_configured" };
  }

  const from =
    process.env.OUTREACH_SMTP_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    user;
  const testMode = isOutreachTestMode();
  const to = testMode ? getOutreachTestEmail() : originalRecipient;
  const category = DEFAULT_CATEGORY;
  const { subject, text, html } = buildOutreachEmail(declaration, {
    recipientEmail: originalRecipient,
    category,
  });

  const mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
  } = {
    from: `"${getOutreachFromName()}" <${from}>`,
    to,
    subject,
    text,
    html,
  };

  const replyTo = process.env.OUTREACH_REPLY_TO?.trim();
  if (replyTo) {
    mail.replyTo = replyTo;
  }

  let lastSmtpError: string | undefined;

  for (const attempt of outreachSmtpAttempts()) {
    try {
      const transporter = createOutreachTransporter({
        host,
        user,
        pass,
        port: attempt.port,
        secure: attempt.secure,
        requireTLS: attempt.requireTLS,
      });
      await transporter.sendMail(mail);

      const record: OutreachSendRecord = {
        id: crypto.randomUUID(),
        declarationId: declaration.id,
        companyName:
          declaration.applicant?.shortName ||
          declaration.applicant?.fullName ||
          "—",
        recipient: to,
        originalRecipient,
        subject,
        sentAt: new Date().toISOString(),
        testMode,
      };
      writeSentRecord(record);
      return { ok: true, record };
    } catch (error) {
      lastSmtpError =
        error instanceof Error ? error.message : String(error);
      continue;
    }
  }

  return {
    ok: false,
    reason: lastSmtpError
      ? smtpErrorReason(lastSmtpError)
      : "smtp_send_failed",
  };
}

export async function sendOutreachBatch(
  declarations: FsaDeclaration[],
  options: { force?: boolean; manual?: boolean; delayMs?: number } = {}
): Promise<
  Array<{
    id: number;
    ok: boolean;
    reason?: string;
    record?: OutreachSendRecord;
  }>
> {
  const delayMs = resolveBatchDelayMs(
    options.delayMs ?? process.env.OUTREACH_SEND_DELAY_MS ?? 3000
  );
  const results = [];

  for (const [index, declaration] of declarations.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    const result = await sendOutreachEmail(declaration, options);
    results.push({
      id: declaration.id,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      record: result.ok ? result.record : undefined,
    });
  }

  return results;
}
