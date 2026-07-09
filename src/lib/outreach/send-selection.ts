import { getSendBlockReason } from "./mailer";
import type { FsaDeclaration, OutreachQueueItem } from "./types";

export function isExcludedFromAutoSend(
  item: FsaDeclaration | OutreachQueueItem
): boolean {
  return Boolean((item as OutreachQueueItem).excludeFromAutoSend);
}

export function sendBlockLabel(
  reason: string | null | undefined
): string | undefined {
  switch (reason) {
    case "already_sent":
      return "письмо по этой декларации уже отправляли";
    case "recipient_already_sent":
      return "на этот email уже отправляли (другая декларация)";
    case "unsubscribed":
      return "отказался от рассылки";
    case "no_corporate_email":
      return "личный или неподходящий email";
    case "no_email":
      return "нет email";
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
  options: { force?: boolean; manual?: boolean } = {}
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

export function summarizeSendBlocks(items: FsaDeclaration[]) {
  const counts: Record<string, number> = {};
  const emailsSeen = new Set<string>();
  let duplicateEmails = 0;

  for (const item of items) {
    const reason = getSendBlockReason(item);
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
    sendable: pickSendableCandidates(items, { forAutoSend: true }).length,
    duplicateEmails,
    counts,
  };
}

export function formatEmptySendMessage(
  summary: ReturnType<typeof summarizeSendBlocks>
): string {
  const parts: string[] = [];

  if (summary.counts.recipient_already_sent) {
    parts.push(
      `${summary.counts.recipient_already_sent} — на email уже писали`
    );
  }
  if (summary.counts.already_sent) {
    parts.push(`${summary.counts.already_sent} — декларация уже в истории`);
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

  return `Сейчас 0 уникальных адресов готовы к отправке (${summary.total} в очереди): ${parts.join("; ")}. Догрузите новые декларации из ФСА.`;
}
