import dns from "node:dns/promises";

/** Кэш MX-проверок: domain → { ok, checkedAt } */
const mxCache = new Map<string, { ok: boolean; checkedAt: number }>();
const MX_CACHE_MS = 24 * 60 * 60 * 1000;

const EMAIL_SYNTAX =
  /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Частые опечатки в реестре ФСА */
const DOMAIN_TYPO_FIXES: Array<{ pattern: RegExp; fix: string; reason: string }> = [
  { pattern: /\.r$/i, fix: ".ru", reason: "domain_typo_r" },
  { pattern: /\.ruu$/i, fix: ".ru", reason: "domain_typo_ruu" },
  { pattern: /\.comm$/i, fix: ".com", reason: "domain_typo_comm" },
  { pattern: /\.con$/i, fix: ".com", reason: "domain_typo_con" },
  { pattern: /\.nte$/i, fix: ".net", reason: "domain_typo_nte" },
  { pattern: /\.ogr$/i, fix: ".org", reason: "domain_typo_ogr" },
  { pattern: /\.ru\.ru$/i, fix: ".ru", reason: "domain_double_ru" },
];

export type EmailValidationIssue =
  | "invalid_syntax"
  | "domain_typo_r"
  | "domain_typo_ruu"
  | "domain_typo_comm"
  | "domain_typo_con"
  | "domain_typo_nte"
  | "domain_typo_ogr"
  | "domain_double_ru"
  | "no_mx";

export function normalizeEmailInput(raw?: string): string {
  return raw?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
}

export function validateEmailSyntax(email: string): EmailValidationIssue | null {
  const value = normalizeEmailInput(email);
  if (!value || !value.includes("@")) return "invalid_syntax";
  if (value.includes("..") || value.startsWith(".") || value.includes("@.")) {
    return "invalid_syntax";
  }
  if (!EMAIL_SYNTAX.test(value)) return "invalid_syntax";
  const [, domain] = value.split("@");
  if (!domain || domain.length < 3 || !domain.includes(".")) {
    return "invalid_syntax";
  }
  return null;
}

/** Синхронная проверка опечаток домена (без DNS). */
export function detectDomainTypo(email: string): EmailValidationIssue | null {
  const value = normalizeEmailInput(email);
  const domain = value.split("@")[1];
  if (!domain) return "invalid_syntax";
  for (const rule of DOMAIN_TYPO_FIXES) {
    if (rule.pattern.test(domain)) return rule.reason as EmailValidationIssue;
  }
  return null;
}

export function suggestEmailFix(email: string): string | null {
  const value = normalizeEmailInput(email);
  const [local, domain] = value.split("@");
  if (!local || !domain) return null;
  for (const rule of DOMAIN_TYPO_FIXES) {
    if (rule.pattern.test(domain)) {
      return `${local}@${domain.replace(rule.pattern, rule.fix)}`;
    }
  }
  return null;
}

function cacheMx(domain: string, ok: boolean) {
  mxCache.set(domain, { ok, checkedAt: Date.now() });
}

function readMxCache(domain: string): boolean | null {
  const hit = mxCache.get(domain);
  if (!hit) return null;
  if (Date.now() - hit.checkedAt > MX_CACHE_MS) {
    mxCache.delete(domain);
    return null;
  }
  return hit.ok;
}

/** Есть ли у домена MX или A (RFC 5321 fallback). */
export async function checkDomainAcceptsMail(domain: string): Promise<boolean> {
  const normalized = domain.trim().toLowerCase();
  if (!normalized) return false;

  const cached = readMxCache(normalized);
  if (cached !== null) return cached;

  let ok = false;
  try {
    const mx = await dns.resolveMx(normalized);
    ok = mx.length > 0;
  } catch {
    try {
      const a = await dns.resolve4(normalized);
      ok = a.length > 0;
    } catch {
      ok = false;
    }
  }

  cacheMx(normalized, ok);
  return ok;
}

export async function validateEmailMx(email: string): Promise<EmailValidationIssue | null> {
  const syntax = validateEmailSyntax(email);
  if (syntax) return syntax;
  const typo = detectDomainTypo(email);
  if (typo) return typo;

  const domain = normalizeEmailInput(email).split("@")[1];
  if (!domain) return "invalid_syntax";

  const accepts = await checkDomainAcceptsMail(domain);
  return accepts ? null : "no_mx";
}

export function isMxValidationEnabled(): boolean {
  return process.env.OUTREACH_VALIDATE_MX !== "false";
}

export async function validateEmailDeliverability(
  email?: string
): Promise<{ ok: true } | { ok: false; reason: EmailValidationIssue }> {
  const value = normalizeEmailInput(email);
  if (!value) return { ok: false, reason: "invalid_syntax" };

  const syntax = validateEmailSyntax(value);
  if (syntax) return { ok: false, reason: syntax };

  const typo = detectDomainTypo(value);
  if (typo) return { ok: false, reason: typo };

  if (!isMxValidationEnabled()) return { ok: true };

  const mxIssue = await validateEmailMx(value);
  if (mxIssue) return { ok: false, reason: mxIssue };

  return { ok: true };
}

export function validationIssueLabel(reason: EmailValidationIssue): string {
  switch (reason) {
    case "invalid_syntax":
      return "некорректный формат email";
    case "no_mx":
      return "домен не принимает почту (нет MX)";
    case "domain_typo_r":
      return "опечатка домена (.r вместо .ru)";
    case "domain_typo_ruu":
      return "опечатка домена (.ruu)";
    case "domain_typo_comm":
      return "опечатка домена (.comm)";
    case "domain_typo_con":
      return "опечатка домена (.con)";
    case "domain_typo_nte":
      return "опечатка домена (.nte)";
    case "domain_typo_ogr":
      return "опечатка домена (.ogr)";
    case "domain_double_ru":
      return "опечатка домена (.ru.ru)";
    default:
      return reason;
  }
}

/** Сброс кэша (тесты). */
export function clearEmailValidationCache(): void {
  mxCache.clear();
}
