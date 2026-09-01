import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  OUTREACH_CATEGORY_LABELS,
  type OutreachCategory,
  type OutreachUnsubscribeRecord,
} from "./types";

const unsubPath = path.join(process.cwd(), "data", "outreach-unsubscribed.json");

type UnsubscribeTokenPayload = {
  email: string;
  category: OutreachCategory;
  companyName?: string;
};

function getSecret(): string {
  return (
    process.env.OUTREACH_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    "outreach-unsub-dev-secret"
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function readUnsubscribeRecords(): OutreachUnsubscribeRecord[] {
  if (!fs.existsSync(unsubPath)) return [];
  return JSON.parse(
    fs.readFileSync(unsubPath, "utf-8")
  ) as OutreachUnsubscribeRecord[];
}

function writeUnsubscribeRecords(records: OutreachUnsubscribeRecord[]): void {
  const dir = path.dirname(unsubPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(unsubPath, JSON.stringify(records, null, 2) + "\n");
}

export function isUnsubscribed(
  email: string,
  category: OutreachCategory
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return readUnsubscribeRecords().some(
    (item) => item.category === category && item.email === normalized
  );
}

export function getCategoryLabel(category: OutreachCategory): string {
  return OUTREACH_CATEGORY_LABELS[category];
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

export function createUnsubscribeToken(
  email: string,
  category: OutreachCategory,
  companyName?: string
): string {
  const payload: UnsubscribeTokenPayload = {
    email: normalizeEmail(email),
    category,
    companyName,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string
): UnsubscribeTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf-8")
    ) as UnsubscribeTokenPayload;
    if (!payload.email || !payload.category) return null;
    if (!OUTREACH_CATEGORY_LABELS[payload.category]) return null;
    return {
      ...payload,
      email: normalizeEmail(payload.email),
    };
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(
  email: string,
  category: OutreachCategory,
  companyName?: string
): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://navicert.pro";
  const token = createUnsubscribeToken(email, category, companyName);
  return `${siteUrl}/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** URL для заголовка List-Unsubscribe (one-click POST на API). */
export function buildUnsubscribeApiUrl(
  email: string,
  category: OutreachCategory,
  companyName?: string
): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://navicert.pro";
  const token = createUnsubscribeToken(email, category, companyName);
  return `${siteUrl}/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function recordUnsubscribe(
  payload: UnsubscribeTokenPayload
): OutreachUnsubscribeRecord {
  const records = readUnsubscribeRecords();
  const email = normalizeEmail(payload.email);
  const existing = records.find(
    (item) => item.category === payload.category && item.email === email
  );
  if (existing) return existing;

  const record: OutreachUnsubscribeRecord = {
    id: crypto.randomUUID(),
    category: payload.category,
    email,
    companyName: payload.companyName,
    unsubscribedAt: new Date().toISOString(),
  };
  records.push(record);
  writeUnsubscribeRecords(records);
  return record;
}

export function listUnsubscribesByCategory(
  category: OutreachCategory
): OutreachUnsubscribeRecord[] {
  return readUnsubscribeRecords()
    .filter((item) => item.category === category)
    .sort(
      (a, b) =>
        Date.parse(b.unsubscribedAt) - Date.parse(a.unsubscribedAt)
    );
}
