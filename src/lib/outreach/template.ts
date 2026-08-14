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

export function buildOutreachSubject(
  declaration: FsaDeclaration,
  options?: { category?: OutreachCategory }
): string {
  const category = options?.category ?? "expiring";
  const company = companyName(declaration);
  if (category === "new_registrations") {
    return `Требования к документам ${company} в 2026 году.`;
  }
  if (category === "expiring_certificates") {
    return `Уведомление о завершении сертификата ${company}!`;
  }
  return `Напоминание о завершении декларации ${company}!`;
}

function signatureFromName(): string {
  const fromName = getOutreachFromName();
  return fromName.trim().toLowerCase() === "андрей громов"
    ? "Громов Андрей"
    : fromName;
}

/** Шаблон «Заканчивающиеся ДС» (актуальный). */
function declarationBodyBlocks(declaration: FsaDeclaration): BodyBlock[] {
  const recipient = companyName(declaration);
  const month = monthLabelRu(declaration.endDate);
  const productCat = productCategory(declaration);

  return [
    {
      type: "p",
      text: "Здравствуйте! Это Андрей из центра сертификации «Нависерт».",
    },
    {
      type: "p",
      text: `Увидел в реестре Росаккредитации, что в ${month} у вашей компании ${recipient} заканчивается декларация на ${productCat}. При необходимости могу прислать ссылку на заканчивающуюся декларацию.`,
    },
    {
      type: "p",
      text: "Чтобы у вас не встали продажи из-за долгого переоформления, лучше обновить её заранее. Мы можем помочь с оформлением под ключ. Скажите, актуально ли обновить документ в ближайшее время?",
    },
    {
      type: "p",
      text: 'Если вы уже в процессе переоформления или вам это просто не интересно, пожалуйста, ответьте на это письмо словом «Нет», и я исключу ваш адрес из мониторинга.',
    },
    { type: "p", text: "С уважением," },
    {
      type: "p",
      text: `${signatureFromName()}, эксперт центра «Нависерт»`,
    },
  ];
}

/** Шаблон «Заканчивающиеся СС» (актуальный). */
function certificateBodyBlocks(declaration: FsaDeclaration): BodyBlock[] {
  const recipient = companyName(declaration);
  const month = monthLabelRu(declaration.endDate);
  const productCat = productCategory(declaration);

  return [
    {
      type: "p",
      text: "Здравствуйте! Это Андрей из центра сертификации «Нависерт».",
    },
    {
      type: "p",
      text: `Заметил в реестре Росаккредитации, что в ${month} у вашей компании ${recipient} заканчивается сертификат соответствия на ${productCat}. При необходимости могу прислать ссылку на заканчивающийся сертификат.`,
    },
    {
      type: "p",
      text: "Чтобы у вас не встали продажи из-за долгого переоформления, лучше обновить документ заранее. Мы можем помочь с оформлением под ключ. Скажите, актуально ли обновление документов в ближайшее время?",
    },
    {
      type: "p",
      text: 'Если вы уже в процессе переоформления или вам это просто не интересно, пожалуйста, ответьте на это письмо словом «Нет», и я исключу ваш адрес из мониторинга.',
    },
    { type: "p", text: "С уважением," },
    {
      type: "p",
      text: `${signatureFromName()}, эксперт центра «Нависерт»`,
    },
  ];
}

/** Шаблон «Недавно зарегистрированным ООО» (актуальный). */
function newRegistrationBodyBlocks(declaration: FsaDeclaration): BodyBlock[] {
  const recipient = companyName(declaration);
  const site = getSite();
  const siteUrl =
    process.env.OUTREACH_SITE_URL?.trim() || "https://navicert-info.ru";
  const fromName = getOutreachFromName();

  return [
    { type: "p", text: "Здравствуйте!" },
    {
      type: "p",
      text: "Это Громов Андрей, руководитель направления в центре сертификации «Нависерт».",
    },
    {
      type: "p",
      text: "Мы помогаем бизнесу защитить себя и следим за тем, чтобы документация компаний была в полном порядке.",
    },
    {
      type: "p",
      text: "Поводом для моего письма стало введение новых критериев оценки соответствия товаров в 2026 году. Усилился контроль документов при поставках, заключении контрактов, выходе на маркетплейсы и проверках госорганов.",
    },
    {
      type: "p",
      text: "Подскажите, вы уже определились с необходимой документацией?",
    },
    {
      type: "p",
      text: "Если нет — укажите, что именно вы планируете производить или продавать, и я вышлю список необходимых вам документов и подходящие варианты их оформления.",
    },
    {
      type: "p",
      text: `В любом случае желаю ${recipient} успешного развития и легкого прохождения любых проверок!`,
    },
    { type: "p", text: "С уважением," },
    { type: "p", text: fromName },
    { type: "p", text: "Руководитель направления, ЦС «Нависерт»" },
    { type: "p", text: `Тел.: ${site.phone}` },
    { type: "p", text: siteUrl },
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
  // В актуальных шаблонах ДС/СС — navicert-info.ru (не основной SITE_URL).
  const siteUrl =
    process.env.OUTREACH_SITE_URL?.trim() || "https://navicert-info.ru";
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
  const recipientEmail = options?.recipientEmail?.trim().toLowerCase();
  const outreachCategory = options?.category ?? "expiring";
  const unsub = recipientEmail
    ? unsubscribeBlock(recipientEmail, outreachCategory, companyName(declaration))
    : null;

  const lines = blocksToText(bodyBlocks(declaration, outreachCategory));
  // У новых организаций контакты уже в подписи шаблона — общий футер не дублируем.
  const withFooter =
    outreachCategory === "new_registrations"
      ? lines
      : `${lines}\n\n${footerLine().text}`;

  if (unsub) {
    return `${withFooter}\n\n${unsub.text}`;
  }

  return withFooter;
}

export function buildOutreachHtml(
  declaration: FsaDeclaration,
  options?: { recipientEmail?: string; category?: OutreachCategory }
): string {
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
  const footerHtml =
    outreachCategory === "new_registrations"
      ? ""
      : `<p>${footerLine().html}</p>`;

  return `<!DOCTYPE html>
<html lang="ru">
<body style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #111;">
${htmlBody}
${footerHtml}
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
