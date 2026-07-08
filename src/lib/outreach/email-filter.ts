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

export function isCorporateEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
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
  reason?: string;
} {
  const value = email?.trim();
  if (!value || !value.includes("@")) {
    return { status: "no_email", reason: "email_missing" };
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
    default:
      return reason ?? "не прошёл фильтр";
  }
}
