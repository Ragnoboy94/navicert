import { getSite } from "@/lib/content";
import { buildUnsubscribeUrl } from "./unsubscribe";
import type { FsaDeclaration, OutreachCategory } from "./types";

const MONTHS_RU = [
  "январе",
  "феврале",
  "марте",
  "апреле",
  "мае",
  "июне",
  "июле",
  "августе",
  "сентябре",
  "октябре",
  "ноябре",
  "декабре",
];

function parseRuDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthLabelRu(endDate: string): string {
  const parsed = parseRuDate(endDate);
  if (!parsed) return endDate;
  return MONTHS_RU[parsed.getMonth()] ?? endDate;
}

function companyName(declaration: FsaDeclaration): string {
  return (
    declaration.applicant?.shortName ||
    declaration.applicant?.fullName ||
    "организация"
  );
}

function productCategory(declaration: FsaDeclaration): string {
  return declaration.productGroup || declaration.productName || "продукция";
}

export function getOutreachSenderName(): string {
  return (
    process.env.OUTREACH_SENDER_NAME?.trim() ||
    "Экспертный центр сертификации Нависерт"
  );
}

export function getOutreachFromName(): string {
  return process.env.OUTREACH_FROM_NAME?.trim() || "Андрей Громов";
}

export function buildOutreachSubject(declaration: FsaDeclaration): string {
  return `Мониторинг реестра ФСА: истечение сроков действия документации ${companyName(declaration)}`;
}

function certDurationLabel(): string {
  return process.env.OUTREACH_CERT_DURATION?.trim() || "до 2 месяцев";
}

function bodyParagraphs(declaration: FsaDeclaration): string[] {
  const senderName = getOutreachSenderName();
  const recipient = companyName(declaration);
  const month = monthLabelRu(declaration.endDate);
  const productCat = productCategory(declaration);
  const year = new Date().getFullYear();

  return [
    `Уважаемые руководители компании ${recipient}!`,
    `${senderName} в рамках планового мониторинга открытых данных реестра Росаккредитации зафиксировал, что у вашей организации в ближайшее время завершается период действия разрешительной документации.`,
    "Статус документов:",
    `В ${month} ${year} года истекает срок действия документов товарной группы: ${productCat}.`,
    `Напоминаем, что процедура сертификации или декларирования (включая отбор образцов, проведение лабораторных испытаний и регистрацию в реестре) может занимать ${certDurationLabel()}.`,
    "Во избежание рисков привлечения к административной ответственности по ст. 14.43 КоАП РФ («Нарушение требований технических регламентов»), задержки поставок или блокировок карточек на маркетплейсах, рекомендуем заблаговременно запустить процедуру переоформления.",
    "Мы готовы предоставить информацию по актуальным срокам и схемам сертификации под ваш ассортимент. Направьте ответ на данное уведомление для связи с профильным техническим специалистом.",
    "С уважением,",
    senderName,
  ];
}

function footerLine(): { text: string; html: string } {
  const site = getSite();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://navicert.pro";
  const tel = site.phoneRaw || site.phone.replace(/\D/g, "");
  const telHref = tel.startsWith("+") ? tel : `+${tel}`;

  return {
    text: `${siteUrl} / ${site.phone}`,
    html: `<a href="${siteUrl}">${siteUrl}</a> / <a href="tel:${telHref}">${site.phone}</a>`,
  };
}

function unsubscribeBlock(
  recipientEmail: string,
  category: OutreachCategory,
  companyName?: string
): { text: string; html: string } {
  const url = buildUnsubscribeUrl(recipientEmail, category, companyName);
  return {
    text: `Если вы не хотите получать подобные информационные уведомления, отпишитесь: ${url}`,
    html: `<p style="margin-top: 24px; font-size: 12px; color: #666;">Если вы не хотите получать подобные информационные уведомления, <a href="${url}" style="color: #666;">отпишитесь от рассылки</a>.</p>`,
  };
}

export function buildOutreachBody(
  declaration: FsaDeclaration,
  options?: { recipientEmail?: string; category?: OutreachCategory }
): string {
  const footer = footerLine();
  const recipientEmail = options?.recipientEmail?.trim().toLowerCase();
  const outreachCategory = options?.category ?? "expiring";
  const unsub = recipientEmail
    ? unsubscribeBlock(recipientEmail, outreachCategory, companyName(declaration))
    : null;

  const lines = bodyParagraphs(declaration).join("\n\n");

  if (unsub) {
    return `${lines}\n\n${footer.text}\n\n${unsub.text}`;
  }

  return `${lines}\n\n${footer.text}`;
}

export function buildOutreachHtml(
  declaration: FsaDeclaration,
  options?: { recipientEmail?: string; category?: OutreachCategory }
): string {
  const footer = footerLine();
  const recipientEmail = options?.recipientEmail?.trim().toLowerCase();
  const outreachCategory = options?.category ?? "expiring";
  const unsub = recipientEmail
    ? unsubscribeBlock(
        recipientEmail,
        outreachCategory,
        companyName(declaration)
      )
    : null;

  const htmlBody = bodyParagraphs(declaration)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru">
<body style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #111;">
${htmlBody}
<p>${footer.html}</p>
${unsub ? unsub.html : ""}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildOutreachEmail(
  declaration: FsaDeclaration,
  options?: { recipientEmail?: string; category?: OutreachCategory }
): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: buildOutreachSubject(declaration),
    text: buildOutreachBody(declaration, options),
    html: buildOutreachHtml(declaration, options),
  };
}
