import { getSendBlockReason } from "./mailer";
import type { FsaDeclaration, OutreachCategory, OutreachQueueItem } from "./types";

export function isExcludedFromAutoSend(
  item: FsaDeclaration | OutreachQueueItem
): boolean {
  return Boolean((item as OutreachQueueItem).excludeFromAutoSend);
}

export function sendBlockLabel(
  reason: string | null | undefined,
  category: OutreachCategory = "expiring"
): string | undefined {
  switch (reason) {
    case "already_sent":
      return category === "expiring_certificates"
        ? "письмо по этому сертификату уже отправляли"
        : category === "new_registrations"
          ? "письмо этой организации уже отправляли"
          : category === "wb_sellers"
            ? "письмо этому продавцу уже отправляли"
            : "письмо по этой декларации уже отправляли";
    case "recipient_already_sent":
      return "на этот email недавно писали — повтор позже";
    case "unsubscribed":
      return "отказался от рассылки";
    case "no_corporate_email":
      return "личный или неподходящий email";
    case "no_email":
      return "нет email";
    case "email_not_deliverable":
      return "email не прошёл проверку доставки";
    case "invalid_syntax":
      return "некорректный формат email";
    case "no_mx":
      return "домен не принимает почту";
    case "domain_typo_r":
    case "domain_typo_ruu":
    case "domain_typo_comm":
    case "domain_typo_con":
    case "domain_typo_nte":
    case "domain_typo_ogr":
    case "domain_double_ru":
      return "опечатка в домене email";
    case "smtp_timeout":
      return "таймаут SMTP — сервер не отвечает";
    case "smtp_auth_failed":
      return "ошибка авторизации SMTP";
    case "smtp_send_failed":
      return "ошибка отправки SMTP";
    case "smtp_not_configured":
      return "SMTP не настроен";
    case "excluded_from_auto":
      return "исключено из автоматической отправки";
    default:
      return reason ?? undefined;
  }
}

export function isSendable(
  item: FsaDeclaration,
  options: { force?: boolean; manual?: boolean; category?: OutreachCategory } = {}
): boolean {
  return getSendBlockReason(item, options) === null;
}

/** Кандидаты на отправку: без блокировок, один адрес — одно письмо за запуск */
export function pickSendableCandidates(
  items: FsaDeclaration[],
  options: {
    force?: boolean;
    manual?: boolean;
    forAutoSend?: boolean;
    limit?: number;
    category?: OutreachCategory;
  } = {}
): FsaDeclaration[] {
  const seenEmails = new Set<string>();
  const result: FsaDeclaration[] = [];

  for (const item of items) {
    if (options.limit !== undefined && result.length >= options.limit) break;
    if (options.forAutoSend && isExcludedFromAutoSend(item)) continue;
    if (getSendBlockReason(item, options)) continue;

    const email = item.applicant?.email?.trim().toLowerCase();
    if (!email) continue;
    if (seenEmails.has(email)) continue;

    seenEmails.add(email);
    result.push(item);
  }

  return result;
}

export function summarizeSendBlocks(
  items: FsaDeclaration[],
  options?: { category?: OutreachCategory }
) {
  const counts: Record<string, number> = {};
  const emailsSeen = new Set<string>();
  let duplicateEmails = 0;

  for (const item of items) {
    const reason = getSendBlockReason(item, options);
    const key = reason ?? "eligible";
    counts[key] = (counts[key] ?? 0) + 1;

    if (!reason) {
      const email = item.applicant?.email?.trim().toLowerCase();
      if (email) {
        if (emailsSeen.has(email)) duplicateEmails += 1;
        else emailsSeen.add(email);
      }
    }
  }

  return {
    total: items.length,
    sendable: pickSendableCandidates(items, {
      forAutoSend: true,
      category: options?.category,
    }).length,
    duplicateEmails,
    counts,
  };
}

export function formatEmptySendMessage(
  summary: ReturnType<typeof summarizeSendBlocks>,
  options?: { category?: OutreachCategory }
): string {
  const category = options?.category ?? "expiring";
  const docLabel =
    category === "expiring_certificates"
      ? "сертификаты"
      : category === "new_registrations"
        ? "организации"
        : category === "wb_sellers"
          ? "продавцы"
          : "декларации";
  const parts: string[] = [];

  if (summary.counts.recipient_already_sent) {
    parts.push(
      `${summary.counts.recipient_already_sent} — пауза перед повтором на тот же email`
    );
  }
  if (summary.counts.already_sent) {
    parts.push(
      `${summary.counts.already_sent} — ${
        category === "expiring_certificates"
          ? "сертификат"
          : category === "new_registrations"
            ? "организация"
            : category === "wb_sellers"
              ? "продавец"
              : "декларация"
      } уже в истории`
    );
  }
  if (summary.counts.unsubscribed) {
    parts.push(`${summary.counts.unsubscribed} — отписались`);
  }
  if (summary.counts.no_corporate_email) {
    parts.push(`${summary.counts.no_corporate_email} — неподходящий email`);
  }
  if (summary.counts.no_email) {
    parts.push(`${summary.counts.no_email} — нет email`);
  }
  if (summary.duplicateEmails > 0) {
    parts.push(
      `${summary.duplicateEmails} — дубликат email в очереди (одно письмо на адрес)`
    );
  }

  if (parts.length === 0) {
    return "Нет подходящих получателей для отправки";
  }

  return `Сейчас 0 уникальных адресов готовы к отправке (${summary.total} в очереди): ${parts.join("; ")}. Догрузите новые ${docLabel} из ФСА.`;
}
