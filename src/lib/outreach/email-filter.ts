import {
  detectDomainTypo,
  normalizeEmailInput,
  validateEmailSyntax,
  type EmailValidationIssue,
} from "./email-validator";

const FREE_EMAIL_DOMAINS = new Set([
  "mail.ru",
  "inbox.ru",
  "list.ru",
  "bk.ru",
  "internet.ru",
  "gmail.com",
  "googlemail.com",
  "yandex.ru",
  "ya.ru",
  "yandex.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "rambler.ru",
  "protonmail.com",
  "proton.me",
]);

export type EmailFilterStatus = "eligible" | "rejected" | "no_email";

export type EmailRejectReason =
  | "personal_email"
  | "email_missing"
  | EmailValidationIssue;

export function isCorporateEmail(email: string): boolean {
  const value = normalizeEmailInput(email);
  if (!value.includes("@")) return false;

  const [local, domain] = value.split("@");
  if (!local || !domain) return false;
  if (FREE_EMAIL_DOMAINS.has(domain)) return false;
  if (local === "noreply" || local === "no-reply" || local.startsWith("noreply.")) {
    return false;
  }

  return true;
}

export function classifyEmail(email?: string): {
  status: EmailFilterStatus;
  reason?: EmailRejectReason;
} {
  const value = normalizeEmailInput(email);
  if (!value || !value.includes("@")) {
    return { status: "no_email", reason: "email_missing" };
  }

  const syntaxIssue = validateEmailSyntax(value);
  if (syntaxIssue) {
    return { status: "rejected", reason: syntaxIssue };
  }

  const typoIssue = detectDomainTypo(value);
  if (typoIssue) {
    return { status: "rejected", reason: typoIssue };
  }

  if (isCorporateEmail(value)) {
    return { status: "eligible" };
  }
  return { status: "rejected", reason: "personal_email" };
}

export function emailFilterLabel(reason?: string): string {
  switch (reason) {
    case "personal_email":
      return "личный ящик (mail.ru, gmail и т.п.)";
    case "not_corporate_prefix":
      return "личный или служебный ящик";
    case "email_missing":
      return "email не найден при загрузке";
    case "invalid_syntax":
      return "некорректный формат email";
    case "no_mx":
      return "домен не принимает почту (нет MX)";
    case "domain_typo_r":
      return "опечатка: .r вместо .ru";
    case "domain_typo_ruu":
      return "опечатка: .ruu вместо .ru";
    case "domain_typo_comm":
      return "опечатка: .comm вместо .com";
    case "domain_typo_con":
      return "опечатка: .con вместо .com";
    case "domain_typo_nte":
      return "опечатка: .nte вместо .net";
    case "domain_typo_ogr":
      return "опечатка: .ogr вместо .org";
    case "domain_double_ru":
      return "опечатка: .ru.ru";
    default:
      return reason ?? "не прошёл фильтр";
  }
}

/** «Личные ящики» / rejected в UI: только email, не прошедшие фильтр — без no_email. */
export function isDisplayRejectedItem(item: {
  emailStatus?: string;
  emailRejectReason?: string;
}): boolean {
  if (item.emailStatus === "no_email") return false;
  if (item.emailRejectReason === "email_missing") return false;
  return item.emailStatus === "rejected";
}
