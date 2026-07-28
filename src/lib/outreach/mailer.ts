import fs from "fs";
import path from "path";
import { classifyEmail, isCorporateEmail } from "./email-filter";
import {
  prepareOutreachQueueForSending,
  type QueueEmailValidationResult,
} from "./queue-email-validation";
import {
  createOutreachTransporter,
  outreachSmtpAttempts,
  smtpErrorReason,
} from "./smtp-transport";
import { buildOutreachEmail, getOutreachFromName } from "./template";
import type { FsaDeclaration, OutreachCategory, OutreachSendRecord } from "./types";
import { isUnsubscribed } from "./unsubscribe";

const DEFAULT_CATEGORY: OutreachCategory = "expiring";

function sentPath(category: OutreachCategory): string {
  const file =
    category === "expiring_certificates"
      ? "outreach-certificates-sent.json"
      : "outreach-sent.json";
  return path.join(process.cwd(), "data", file);
}

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
  return readSentRecordsByCategory("expiring");
}

export function readSentRecordsByCategory(
  category: OutreachCategory = "expiring"
): OutreachSendRecord[] {
  const spath = sentPath(category);
  if (!fs.existsSync(spath)) return [];
  return JSON.parse(fs.readFileSync(spath, "utf-8")) as OutreachSendRecord[];
}

/** Пауза перед повторным письмом на тот же корпоративный email (другая декларация). */
export function getRecipientCooldownDays(): number {
  const parsed = Number(process.env.OUTREACH_RECIPIENT_COOLDOWN_DAYS ?? 7);
  if (!Number.isFinite(parsed) || parsed < 0) return 7;
  return Math.min(Math.max(parsed, 0), 90);
}

function getRecipientCooldownMs(): number {
  return getRecipientCooldownDays() * 24 * 60 * 60 * 1000;
}

export function getLastSendToRecipient(
  email: string,
  records: OutreachSendRecord[] = readSentRecordsByCategory()
): OutreachSendRecord | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  let latest: OutreachSendRecord | null = null;
  for (const record of records) {
    if (record.originalRecipient.trim().toLowerCase() !== normalized) continue;
    if (!latest || record.sentAt > latest.sentAt) latest = record;
  }
  return latest;
}

export function getRecipientCooldownUntil(
  email: string,
  records: OutreachSendRecord[] = readSentRecordsByCategory()
): string | null {
  const last = getLastSendToRecipient(email, records);
  if (!last) return null;
  const cooldownMs = getRecipientCooldownMs();
  if (cooldownMs === 0) return null;
  const until = new Date(new Date(last.sentAt).getTime() + cooldownMs);
  if (until.getTime() <= Date.now()) return null;
  return until.toISOString();
}

export function isRecipientInCooldown(
  email: string,
  records: OutreachSendRecord[] = readSentRecordsByCategory()
): boolean {
  return getRecipientCooldownUntil(email, records) !== null;
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

function writeSentRecord(
  record: OutreachSendRecord,
  category: OutreachCategory = DEFAULT_CATEGORY
): void {
  const dir = path.dirname(sentPath(category));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const records = readSentRecordsByCategory(category);
  records.push(record);
  fs.writeFileSync(
    sentPath(category),
    JSON.stringify(records, null, 2) + "\n"
  );
}

export function wasAlreadySent(
  declarationId: number,
  category: OutreachCategory = DEFAULT_CATEGORY
): boolean {
  return readSentRecordsByCategory(category).some(
    (item) => item.declarationId === declarationId
  );
}

export function wasAlreadySentToRecipient(email: string): boolean {
  return isRecipientInCooldown(email);
}

export function getSendBlockReason(
  declaration: FsaDeclaration,
  options: {
    force?: boolean;
    manual?: boolean;
    category?: OutreachCategory;
  } = {}
): string | null {
  if (options.manual) {
    return declaration.applicant?.email?.trim() ? null : "no_email";
  }

  const category = options.category ?? DEFAULT_CATEGORY;
  if (options.force) return null;
  if (wasAlreadySent(declaration.id, category)) return "already_sent";

  const email =
    declaration.applicant?.email?.trim().toLowerCase() ||
    resolveRecipientEmail(declaration);
  if (email && wasAlreadySentToRecipient(email)) {
    return "recipient_already_sent";
  }
  if (email && isUnsubscribed(email, category)) {
    return "unsubscribed";
  }

  const { status, reason } = classifyEmail(declaration.applicant?.email);
  if (status !== "eligible") return reason ?? "no_corporate_email";

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
  options: {
    force?: boolean;
    manual?: boolean;
    category?: OutreachCategory;
    /** Внутренний флаг: очередь уже проверена в sendOutreachBatch */
    skipQueueRefresh?: boolean;
  } = {}
): Promise<{ ok: true; record: OutreachSendRecord } | { ok: false; reason: string }> {
  if (!options.skipQueueRefresh && !options.manual) {
    const { queue } = await prepareOutreachQueueForSending({
      category: options.category ?? DEFAULT_CATEGORY,
    });
    const stillEligible = queue?.items.some((item) => item.id === declaration.id);
    if (!stillEligible && !options.force) {
      return { ok: false, reason: "email_not_deliverable" };
    }
  }

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
  const category = options.category ?? DEFAULT_CATEGORY;
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
      writeSentRecord(record, category);
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

export type SendOutreachBatchResult = {
  results: Array<{
    id: number;
    ok: boolean;
    reason?: string;
    record?: OutreachSendRecord;
  }>;
  emailValidation: QueueEmailValidationResult | null;
};

export async function sendOutreachBatch(
  declarations: FsaDeclaration[],
  options: {
    force?: boolean;
    manual?: boolean;
    delayMs?: number;
    category?: OutreachCategory;
  } = {}
): Promise<SendOutreachBatchResult> {
  const needsQueueValidation = !options.manual;
  const prepared = needsQueueValidation
    ? await prepareOutreachQueueForSending({
        category: options.category ?? DEFAULT_CATEGORY,
      })
    : { queue: null, stats: null };
  const eligibleIds = new Set(prepared.queue?.items.map((item) => item.id) ?? []);
  const rejectedReasons = new Map(
    (prepared.queue?.rejected ?? []).map((item) => [
      item.id,
      item.emailRejectReason ?? "email_not_deliverable",
    ])
  );

  const delayMs = options.manual
    ? 0
    : resolveBatchDelayMs(options.delayMs ?? process.env.OUTREACH_SEND_DELAY_MS ?? 3000);
  const results: SendOutreachBatchResult["results"] = [];
  let sendIndex = 0;

  for (const declaration of declarations) {
    if (needsQueueValidation && !eligibleIds.has(declaration.id) && !options.force) {
      results.push({
        id: declaration.id,
        ok: false,
        reason: rejectedReasons.get(declaration.id) ?? "email_not_deliverable",
      });
      continue;
    }

    if (sendIndex > 0 && delayMs > 0) await sleep(delayMs);
    sendIndex += 1;

    const result = await sendOutreachEmail(declaration, {
      ...options,
      skipQueueRefresh: true,
    });
    results.push({
      id: declaration.id,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      record: result.ok ? result.record : undefined,
    });
  }

  return { results, emailValidation: prepared.stats };
}
