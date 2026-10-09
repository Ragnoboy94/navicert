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
  | { type: "p"; text: string; bold?: boolean; underline?: boolean }
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

function signatureFromName(): string {
  const fromName = getOutreachFromName();
  return fromName.trim().toLowerCase() === "андрей громов"
    ? "Громов Андрей"
    : fromName;
}

function outreachPhone(): string {
  return getSite().phone || "+7 (911) 472-94-27";
}

function outreachSiteHost(): string {
  const raw =
    process.env.OUTREACH_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://navicert.pro";
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/$/, "") || "navicert.pro";
  }
}

type VariantTemplate = {
  id: string;
  subject: (company: string) => string;
  blocks: (ctx: {
    month: string;
    product: string;
    phone: string;
    siteHost: string;
  }) => BodyBlock[];
};

type DeclarationTemplate = VariantTemplate;

/** Актуальные шаблоны «Заканчивающиеся ДС» — при отправке выбирается случайный. */
export const DECLARATION_TEMPLATES: DeclarationTemplate[] = [
  {
    id: "status",
    subject: (company) => `Касательно статуса декларации ${company}`,
    blocks: ({ month, product, phone }) => [
      { type: "p", text: "Здравствуйте!" },
      {
        type: "p",
        text: `При плановом анализе открытого реестра Росаккредитации обратили внимание, что в ${month} истекает срок действия декларации соответствия на ${product}. При необходимости можем предоставить точную ссылку на запись в реестре ФСА.`,
      },
      {
        type: "p",
        text: "Подскажите, пожалуйста, планирует ли ваша организация продлевать или переоформлять данный документ?",
      },
      {
        type: "p",
        text: "Если вопрос актуален, просим сообщить, на какой email или кому из ответственных специалистов мы можем направить официальный запрос условий для расчета.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Телефон: ${phone}` },
    ],
  },
  {
    id: "info_request",
    subject: (company) => `Информация касательно декларации для ${company}`,
    blocks: ({ month, product, phone }) => [
      { type: "p", text: "Уважаемые коллеги, здравствуйте!" },
      {
        type: "p",
        text: `Направляем информационный запрос касательно разрешительной документации вашей компании. По данным государственного реестра ФСА, в ${month} заканчивается срок действия декларации на ${product}.`,
      },
      {
        type: "p",
        text: "Поскольку процедура проведения испытаний и регистрации новых документов занимает определенное время, просим переслать данное обращение сотрудникам, ответственным за сертификацию продукции или ВЭД.",
      },
      {
        type: "p",
        text: "Будем признательны, если свяжете нас с профильным специалистом ответственным за подготовку и переоформление документации.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Телефон: ${phone}` },
    ],
  },
  {
    id: "planned_update",
    subject: (company) => `О плановом обновлении декларации ${company}`,
    blocks: ({ month, product, phone, siteHost }) => [
      { type: "p", text: "Добрый день!" },
      {
        type: "p",
        text: `Настоящим информируем, что согласно сведениям из единого реестра Росаккредитации, в ${month} истекает срок действия декларации о соответствии на ${product}.`,
      },
      {
        type: "p",
        text: "В связи с тем, что предсертификационные процедуры и лабораторные испытания требуют заблаговременной подготовки, просим передать данную информацию сотрудникам, ответственным за сертификацию продукции или ВЭД.",
      },
      {
        type: "p",
        text: "Если вопрос актуален, просим сообщить, на какой email или кому из ответственных специалистов мы можем направить точную ссылку на запись в реестре ФСА.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Тел. ${phone}` },
      { type: "p", text: `Сайт: ${siteHost}` },
    ],
  },
  {
    id: "fsa_monitoring",
    subject: (company) =>
      `Мониторинг реестра ФСА: статус декларации ${company}`,
    blocks: ({ month, product, phone, siteHost }) => [
      { type: "p", text: "Уважаемые коллеги, добрый день!" },
      {
        type: "p",
        text: `В рамках регулярного мониторинга реестров Федеральной службы по аккредитации (ФСА) зафиксировано, что в ${month} завершается период действия декларации соответствия на ${product} вашей организации.`,
      },
      {
        type: "p",
        text: "В связи с тем, что предсертификационные процедуры и лабораторные испытания требуют заблаговременной подготовки, просим передать данную информацию сотрудникам, ответственным за сертификацию продукции или ВЭД.",
      },
      {
        type: "p",
        text: "Если вопрос актуален, просим сообщить, на какой email или кому из ответственных специалистов мы можем направить точную ссылку на запись в реестре ФСА.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Тел. ${phone}` },
      { type: "p", text: `Сайт: ${siteHost}` },
    ],
  },
];

export function declarationTemplateCount(): number {
  return DECLARATION_TEMPLATES.length;
}

function pickTemplateIndex(n: number, forced?: number): number {
  if (typeof forced === "number" && Number.isFinite(forced)) {
    const i = Math.trunc(forced);
    if (i >= 0 && i < n) return i;
  }
  return Math.floor(Math.random() * n);
}

export function pickDeclarationTemplateIndex(forced?: number): number {
  return pickTemplateIndex(DECLARATION_TEMPLATES.length, forced);
}

/** Актуальные шаблоны «Заканчивающиеся СС» — при отправке выбирается случайный. */
export const CERTIFICATE_TEMPLATES: VariantTemplate[] = [
  {
    id: "status",
    subject: (company) => `Касательно статуса сертификата ${company}`,
    blocks: ({ month, product, phone }) => [
      { type: "p", text: "Здравствуйте!" },
      {
        type: "p",
        text: `При плановом анализе открытого реестра Росаккредитации обратили внимание, что в ${month} истекает срок действия сертификата соответствия на ${product}. При необходимости можем предоставить точную ссылку на запись в реестре ФСА.`,
      },
      {
        type: "p",
        text: "Если вопрос актуален, просим сообщить, на какой email или кому из ответственных специалистов мы можем направить официальный запрос условий для расчета.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Телефон: ${phone}` },
    ],
  },
  {
    id: "status_change",
    subject: (company) => `Изменение статуса сертификата ${company}`,
    blocks: ({ month, product, phone }) => [
      { type: "p", text: "Здравствуйте!" },
      {
        type: "p",
        text: "Меня зовут Андрей Громов, я эксперт сертификационного центра «Нависерт».",
      },
      {
        type: "p",
        text: `В ходе проверки открытого реестра Росаккредитации заметили, что в ${month} у вашей компании оканчивается действие сертификата на ${product}.`,
      },
      {
        type: "p",
        text: "Подскажите, вы уже занимаетесь переоформлением этого документа или вопрос пока открыт?",
      },
      {
        type: "p",
        text: "Если решение еще не принято, напишите, пожалуйста, актуальный email или контакты ответственного лица для связи по вопросам разрешительной документации.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Телефон: ${phone}` },
    ],
  },
  {
    id: "ending_audit",
    subject: (company) => `Окончание действия сертификата ${company}`,
    blocks: ({ month, product, phone }) => [
      { type: "p", text: "Коллеги, здравствуйте!" },
      {
        type: "p",
        text: "Меня зовут Андрей Громов, я представляю сертификационный центр «Нависерт».",
      },
      {
        type: "p",
        text: `Мы проводим аудит документов в вашей отрасли и заметили, что в ${month} у вас завершается срок действия сертификата на ${product}. При необходимости готовы предоставить точную ссылку на запись в государственном реестре.`,
      },
      {
        type: "p",
        text: "Настоящее сообщение направлено исключительно в целях информирования о статусе разрешительной документации вашей организации.",
      },
      {
        type: "p",
        text: "Если вы заинтересованы, укажите, пожалуйста, email или контакт сотрудника для связи по вопросу сертификации.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Телефон: ${phone}` },
    ],
  },
  {
    id: "ending_fsa",
    subject: (company) => `Окончание действия сертификата ${company}`,
    blocks: ({ month, product, phone }) => [
      { type: "p", text: "Здравствуйте!" },
      {
        type: "p",
        text: `Информируем вас, что по данным открытого реестра ФСА, в ${month} подходит к концу срок действия сертификата соответствия на ${product}.`,
      },
      {
        type: "p",
        text: "Сообщение носит справочный характер для своевременного контроля за архивными и действующими документами вашей организации.",
      },
      {
        type: "p",
        text: "Если вопрос переоформления открыт, и вы рассматриваете предложения, подскажите, email или контакт сотрудника для связи по вопросу сертификации.",
      },
      { type: "p", text: "С уважением," },
      {
        type: "p",
        text: `${signatureFromName()}, эксперт центра «Нависерт»`,
      },
      { type: "p", text: `Телефон: ${phone}` },
    ],
  },
];

export function certificateTemplateCount(): number {
  return CERTIFICATE_TEMPLATES.length;
}

export function pickCertificateTemplateIndex(forced?: number): number {
  return pickTemplateIndex(CERTIFICATE_TEMPLATES.length, forced);
}

function declarationTemplateContext(declaration: FsaDeclaration) {
  return {
    month: monthLabelRu(declaration.endDate),
    product: productCategory(declaration),
    phone: outreachPhone(),
    siteHost: outreachSiteHost(),
  };
}

function declarationBodyBlocks(
  declaration: FsaDeclaration,
  templateIndex: number
): BodyBlock[] {
  const template =
    DECLARATION_TEMPLATES[templateIndex] ?? DECLARATION_TEMPLATES[0];
  return template.blocks(declarationTemplateContext(declaration));
}

function certificateBodyBlocks(
  declaration: FsaDeclaration,
  templateIndex: number
): BodyBlock[] {
  const template =
    CERTIFICATE_TEMPLATES[templateIndex] ?? CERTIFICATE_TEMPLATES[0];
  return template.blocks(declarationTemplateContext(declaration));
}

export function buildOutreachSubject(
  declaration: FsaDeclaration,
  options?: { category?: OutreachCategory; templateIndex?: number }
): string {
  const category = options?.category ?? "expiring";
  const company = companyName(declaration);
  if (category === "wb_sellers") {
    return `Новые требования для продаж на маркетплейсах с 1 сентября: памятка для команды ${company}`;
  }
  if (category === "new_registrations") {
    return `Требования к документам ${company} в 2026 году.`;
  }
  if (category === "expiring_certificates") {
    const idx = pickCertificateTemplateIndex(options?.templateIndex);
    return CERTIFICATE_TEMPLATES[idx].subject(company);
  }
  const idx = pickDeclarationTemplateIndex(options?.templateIndex);
  return DECLARATION_TEMPLATES[idx].subject(company);
}

/** Шаблон продавцам маркетплейсов (Wildberries). */
function wbSellerBodyBlocks(declaration: FsaDeclaration): BodyBlock[] {
  const recipient = companyName(declaration);
  const site = getSite();
  const siteUrl =
    process.env.OUTREACH_SITE_URL?.trim() || "https://navicert-info.ru";
  const fromName = getOutreachFromName();

  return [
    { type: "p", text: "Здравствуйте!" },
    {
      type: "p",
      text: `Это Андрей Громов, руководитель сертификационного центра «Нависерт». У меня важная информация для ${recipient} об изменениях в законодательстве, которые напрямую затрагивают продажи на маркетплейсах.`,
    },
    {
      type: "p",
      text: "С 1 сентября 2026 года (ФЗ № 546-ФЗ): продавцы обязаны размещать в карточках активные ссылки на записи в реестре Росаккредитации (ФГИС) или ЕАЭС. Если товар не подлежит сертификации, необходимо загрузить отказное письмо.",
    },
    {
      type: "p",
      text: "С 1 октября 2026 года (ФЗ № 289-ФЗ «О регулировании платформенной экономики»): маркетплейсы теперь несут юридическую ответственность за легальность товаров.",
    },
    { type: "label", text: "Что это значит на практике?" },
    {
      type: "ul",
      items: [
        "Площадки уже запустили автоматическую премодерацию. Кнопка «Опубликовать» заблокирована до внесения в карточку живой ссылки на документ.",
        "Роботы маркетплейсов будут мгновенно скрывать товары, если статус вашего сертификата или декларации сменится на «Истек» или «Аннулирован», а также если данные в личном кабинете или карточке не совпадут с госреестром.",
        "Даже если товар не подлежит обязательной сертификации, вы обязаны загрузить отказное письмо и прямо указать в карточке для покупателей: «Товар безопасности не угрожает, сертификат не нужен».",
      ],
    },
    {
      type: "p",
      text: "Чтобы вы не теряли позиции в выдаче и не попали под блокировки, «Нависерт» поможет проверить текущие документы на корректность и оперативно оформить недостающие.",
    },
    {
      type: "p",
      text: "Просто ответьте на это письмо — эксперт свяжется с вами и поможет во всем разобраться!",
      bold: true,
      underline: true,
    },
    { type: "p", text: "С уважением," },
    { type: "p", text: fromName },
    { type: "p", text: "Руководитель направления, ЦС «Нависерт»" },
    { type: "p", text: `Тел.: ${site.phone}` },
    { type: "p", text: siteUrl },
  ];
}

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
  category: OutreachCategory,
  templateIndex?: number
): BodyBlock[] {
  if (category === "wb_sellers") {
    return wbSellerBodyBlocks(declaration);
  }
  if (category === "new_registrations") {
    return newRegistrationBodyBlocks(declaration);
  }
  if (category === "expiring_certificates") {
    return certificateBodyBlocks(
      declaration,
      pickCertificateTemplateIndex(templateIndex)
    );
  }
  return declarationBodyBlocks(
    declaration,
    pickDeclarationTemplateIndex(templateIndex)
  );
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
      let inner = escapeHtml(block.text);
      if (block.bold) inner = `<strong>${inner}</strong>`;
      if (block.underline) inner = `<u>${inner}</u>`;
      return `<p>${inner}</p>`;
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
  options?: {
    recipientEmail?: string;
    category?: OutreachCategory;
    templateIndex?: number;
  }
): string {
  const recipientEmail = options?.recipientEmail?.trim().toLowerCase();
  const outreachCategory = options?.category ?? "expiring";
  const templateIndex = resolveVariantTemplateIndex(
    outreachCategory,
    options?.templateIndex
  );
  const unsub = recipientEmail
    ? unsubscribeBlock(recipientEmail, outreachCategory, companyName(declaration))
    : null;

  const lines = blocksToText(
    bodyBlocks(declaration, outreachCategory, templateIndex)
  );
  // Контакты уже в подписи шаблона ДС / СС / новых орг / WB — общий футер не дублируем.
  const withFooter = hasInlineContacts(outreachCategory)
    ? lines
    : `${lines}\n\n${footerLine().text}`;

  if (unsub) {
    return `${withFooter}\n\n${unsub.text}`;
  }

  return withFooter;
}

export function buildOutreachHtml(
  declaration: FsaDeclaration,
  options?: {
    recipientEmail?: string;
    category?: OutreachCategory;
    templateIndex?: number;
  }
): string {
  const recipientEmail = options?.recipientEmail?.trim().toLowerCase();
  const outreachCategory = options?.category ?? "expiring";
  const templateIndex = resolveVariantTemplateIndex(
    outreachCategory,
    options?.templateIndex
  );
  const unsub = recipientEmail
    ? unsubscribeBlock(
        recipientEmail,
        outreachCategory,
        companyName(declaration)
      )
    : null;

  const htmlBody = blocksToHtml(
    bodyBlocks(declaration, outreachCategory, templateIndex)
  );
  const footerHtml = hasInlineContacts(outreachCategory)
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

function hasInlineContacts(category: OutreachCategory): boolean {
  return (
    category === "new_registrations" ||
    category === "wb_sellers" ||
    category === "expiring" ||
    category === "expiring_certificates"
  );
}

function resolveVariantTemplateIndex(
  category: OutreachCategory,
  forced?: number
): number | undefined {
  if (category === "expiring") {
    return pickDeclarationTemplateIndex(forced);
  }
  if (category === "expiring_certificates") {
    return pickCertificateTemplateIndex(forced);
  }
  return undefined;
}

function variantTemplateId(
  category: OutreachCategory,
  templateIndex: number | undefined
): string | undefined {
  if (templateIndex == null) return undefined;
  if (category === "expiring") {
    return DECLARATION_TEMPLATES[templateIndex]?.id;
  }
  if (category === "expiring_certificates") {
    return CERTIFICATE_TEMPLATES[templateIndex]?.id;
  }
  return undefined;
}

export function buildOutreachEmail(
  declaration: FsaDeclaration,
  options?: {
    recipientEmail?: string;
    category?: OutreachCategory;
    /** Фиксированный вариант шаблона ДС/СС (для тестов); иначе случайный */
    templateIndex?: number;
  }
): {
  subject: string;
  text: string;
  html: string;
  templateIndex?: number;
  templateId?: string;
} {
  const category = options?.category ?? "expiring";
  const templateIndex = resolveVariantTemplateIndex(
    category,
    options?.templateIndex
  );
  return {
    subject: buildOutreachSubject(declaration, { category, templateIndex }),
    text: buildOutreachBody(declaration, {
      ...options,
      category,
      templateIndex,
    }),
    html: buildOutreachHtml(declaration, {
      ...options,
      category,
      templateIndex,
    }),
    templateIndex,
    templateId: variantTemplateId(category, templateIndex),
  };
}
