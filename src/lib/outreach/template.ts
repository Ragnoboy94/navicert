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

type BodyBlock =
  | { type: "p"; text: string }
  | { type: "label"; text: string }
  | { type: "ul"; items: string[] };

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

function endYear(endDate: string): number {
  return parseRuDate(endDate)?.getFullYear() ?? new Date().getFullYear();
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

function documentNoun(category: OutreachCategory): string {
  switch (category) {
    case "expiring_certificates":
      return "сертификатов";
    case "new_registrations":
      return "регистрации";
    case "expiring":
    default:
      return "деклараций";
  }
}

export function buildOutreachSubject(
  declaration: FsaDeclaration,
  options?: { category?: OutreachCategory }
): string {
  const category = options?.category ?? "expiring";
  const company = companyName(declaration);
  if (category === "new_registrations") {
    return `Поздравляем с регистрацией ${company}: сертификация и декларации`;
  }
  if (category === "expiring_certificates") {
    return `Мониторинг реестра ФСА: завершение срока действия документации ${company}`;
  }
  return `Мониторинг реестра ФСА: истечение сроков действия ${documentNoun(category)} ${company}`;
}

function certDurationLabel(): string {
  return process.env.OUTREACH_CERT_DURATION?.trim() || "до 2 месяцев";
}

function declarationBodyBlocks(declaration: FsaDeclaration): BodyBlock[] {
  const senderName = getOutreachSenderName();
  const recipient = companyName(declaration);
  const month = monthLabelRu(declaration.endDate);
  const productCat = productCategory(declaration);
  const year = endYear(declaration.endDate);

  return [
    { type: "p", text: `Уважаемые руководители компании ${recipient}!` },
    {
      type: "p",
      text: `${senderName} в рамках планового мониторинга открытых данных реестра Росаккредитации зафиксировал, что у вашей организации в ближайшее время завершается период действия разрешительной документации.`,
    },
    { type: "label", text: "Статус документов:" },
    {
      type: "p",
      text: `В ${month} ${year} года истекает срок действия документов товарной группы: ${productCat}.`,
    },
    {
      type: "p",
      text: `Напоминаем, что процедура сертификации или декларирования (включая отбор образцов, проведение лабораторных испытаний и регистрацию в реестре) может занимать ${certDurationLabel()}.`,
    },
    {
      type: "p",
      text: "Во избежание рисков привлечения к административной ответственности по ст. 14.43 КоАП РФ («Нарушение требований технических регламентов»), задержки поставок или блокировок карточек на маркетплейсах, рекомендуем заблаговременно запустить процедуру переоформления.",
    },
    {
      type: "p",
      text: "Мы готовы предоставить информацию по актуальным срокам и схемам сертификации под ваш ассортимент. Направьте ответ на данное уведомление для связи с профильным техническим специалистом.",
    },
    { type: "p", text: "С уважением," },
    { type: "p", text: senderName },
  ];
}

/** Шаблон «Заканчивающиеся СС» — только для сертификатов. */
function certificateBodyBlocks(declaration: FsaDeclaration): BodyBlock[] {
  const recipient = companyName(declaration);
  const month = monthLabelRu(declaration.endDate);
  const year = endYear(declaration.endDate);
  const number = declaration.number?.trim() || "—";
  const productCat = productCategory(declaration);

  return [
    { type: "p", text: `Уважаемые руководители компании ${recipient}!` },
    {
      type: "p",
      text: "Центр сертификации «Нависерт» в рамках планового мониторинга открытых данных реестра Росаккредитации зафиксировал, что у Вас в ближайшее время заканчивается срок действия разрешительной документации.",
    },
    { type: "label", text: "Статус документов:" },
    {
      type: "ul",
      items: [
        `В ${month} ${year} года истекает срок действия сертификата соответствия № ${number} оформленного на: ${productCat}.`,
      ],
    },
    {
      type: "p",
      text: "Ответьте на данное уведомление, и технический специалист вышлет вам ссылку на заканчивающийся документ.",
    },
    {
      type: "p",
      text: `Также хотим напомнить, что процедура сертификации (включая отбор образцов, проведение лабораторных испытаний и регистрацию в реестре) может занимать ${certDurationLabel()}.`,
    },
    {
      type: "p",
      text: "Мы готовы предоставить информацию по актуальным срокам и схемам сертификации вашего ассортимента продукции.",
    },
    { type: "p", text: "С уважением," },
    { type: "p", text: "Экспертный центр Нависерт" },
  ];
}

function newRegistrationBodyBlocks(declaration: FsaDeclaration): BodyBlock[] {
  const senderName = getOutreachSenderName();
  const recipient = companyName(declaration);
  const fromName = getOutreachFromName();

  return [
    { type: "p", text: `Здравствуйте, ${recipient}!` },
    {
      type: "p",
      text: `Поздравляем с государственной регистрацией вашей организации. ${senderName} помогает новым компаниям быстро пройти обязательную оценку соответствия: декларации и сертификаты по ТР ТС / ТР ЕАЭС.`,
    },
    {
      type: "p",
      text: "Мы подскажем, какие документы нужны именно для вашего ОКВЭД и ассортимента, и сопроводим регистрацию в реестре ФСА.",
    },
    {
      type: "ul",
      items: [
        "Бесплатная первичная консультация по схемам сертификации",
        "Подготовка комплекта документов и испытания",
        "Регистрация деклараций и сертификатов в реестре",
      ],
    },
    {
      type: "p",
      text: "Ответьте на это письмо — специалист свяжется с вами и уточнит задачу.",
    },
    { type: "p", text: "С уважением," },
    { type: "p", text: fromName },
    { type: "p", text: "Экспертный центр Нависерт" },
  ];
}

function bodyBlocks(
  declaration: FsaDeclaration,
  category: OutreachCategory
): BodyBlock[] {
  if (category === "new_registrations") {
    return newRegistrationBodyBlocks(declaration);
  }
  return category === "expiring_certificates"
    ? certificateBodyBlocks(declaration)
    : declarationBodyBlocks(declaration);
}

function blocksToText(blocks: BodyBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "ul") {
      parts.push(block.items.map((item) => `• ${item}`).join("\n"));
    } else {
      parts.push(block.text);
    }
  }
  return parts.join("\n\n");
}

function blocksToHtml(blocks: BodyBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "ul") {
        const items = block.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("");
        return `<ul style="margin: 0 0 1em; padding-left: 1.25em;">${items}</ul>`;
      }
      if (block.type === "label") {
        return `<p><strong>${escapeHtml(block.text)}</strong></p>`;
      }
      return `<p>${escapeHtml(block.text)}</p>`;
    })
    .join("\n");
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

  const lines = blocksToText(bodyBlocks(declaration, outreachCategory));

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

  const htmlBody = blocksToHtml(bodyBlocks(declaration, outreachCategory));

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
  const category = options?.category ?? "expiring";
  return {
    subject: buildOutreachSubject(declaration, { category }),
    text: buildOutreachBody(declaration, { ...options, category }),
    html: buildOutreachHtml(declaration, { ...options, category }),
  };
}
