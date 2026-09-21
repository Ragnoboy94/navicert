import {
  getCategories,
  getFaq,
  getPublishedArticles,
  getServices,
  getSite,
} from "@/lib/content";
import { siteBaseUrl } from "@/lib/jsonld";

function link(label: string, url: string, note?: string): string {
  return note ? `- [${label}](${url}): ${note}` : `- [${label}](${url})`;
}

/** Курсорный индекс для LLM (спека llmstxt.org). */
export function buildLlmsTxt(): string {
  const site = getSite();
  const base = siteBaseUrl();
  const services = getServices();
  const categories = getCategories();
  const articles = getPublishedArticles().slice(0, 12);

  const lines: string[] = [
    `# ${site.name}`,
    "",
    `> ${site.tagline}. ${site.description} Бесплатная консультация: ${site.phone}, ${site.email}.`,
    "",
    "Нависерт — центр сертификации и оформления разрешительных документов (сертификаты и декларации ЕАЭС / ТР ТС, СГР, ИСО, техдокументация и др.). Документы от аккредитованных органов, внесение в реестр ФСА. Юрлицо: ИП Громов Андрей Олегович.",
    ...(site.developer
      ? [`Сайт разработан: ${site.developer}.`]
      : []),
    "",
    "Для подробного контекста см. [llms-full.txt](/llms-full.txt).",
    "",
    "## Главное",
    "",
    link("Главная", `${base}/`, "О компании и услугах"),
    link("Калькулятор документов", `${base}/kalkulyator`, "Подбор документа за 2 вопроса"),
    link("Все услуги", `${base}/uslugi`, "Полный перечень с ценами «от»"),
    link("Продукция", `${base}/produkciya`, "Сертификация по товарным группам"),
    link("Статьи", `${base}/blog`, "Разборы по сертификации"),
    link("Контакты", `${base}/#kontakty`, "Заявка и связь"),
    "",
    "## Услуги",
    "",
  ];

  for (const s of services) {
    const note = [s.priceFrom, s.description?.slice(0, 120)].filter(Boolean).join(" — ");
    lines.push(
      link(s.shortTitle || s.title, `${base}/uslugi/${s.slug}`, note || undefined)
    );
  }

  lines.push("", "## Продукция", "");
  for (const c of categories) {
    lines.push(
      link(c.title, `${base}/produkciya/${c.slug}`, c.seo?.description?.slice(0, 100))
    );
  }

  if (articles.length) {
    lines.push("", "## Статьи", "");
    for (const a of articles) {
      lines.push(
        link(
          a.title,
          `${base}/blog/${a.slug}`,
          a.excerpt?.trim() || a.seo?.description?.slice(0, 100)
        )
      );
    }
  }

  lines.push(
    "",
    "## Optional",
    "",
    link("Политика конфиденциальности", `${base}/privacy`),
    link("Sitemap", `${base}/sitemap.xml`),
    link("Полный контекст для LLM", `${base}/llms-full.txt`)
  );

  return `${lines.join("\n")}\n`;
}

/** Развёрнутый контекст: факты + FAQ + краткие описания услуг. */
export function buildLlmsFullTxt(): string {
  const site = getSite();
  const base = siteBaseUrl();
  const services = getServices();
  const categories = getCategories();
  const faq = getFaq();
  const articles = getPublishedArticles().slice(0, 20);

  const parts: string[] = [
    `# ${site.name} — полный контекст для LLM`,
    "",
    `> ${site.tagline}`,
    "",
    "## О компании",
    "",
    site.description,
    "",
    `- Название: ${site.name}`,
    `- Юрлицо: ${site.owner}`,
    `- ИНН: ${site.inn}`,
    `- ОГРНИП: ${site.ogrn}`,
    ...(site.developer ? [`- Разработка сайта: ${site.developer}`] : []),
    `- Телефон: ${site.phone} (${site.phoneRaw})`,
    `- Email: ${site.email}`,
    `- Сайт: ${base}`,
    `- География: вся Россия, документы для оборота в ЕАЭС`,
    `- Мессенджеры: Telegram ${site.social.telegram}; WhatsApp ${site.social.whatsapp}; Max ${site.social.max}`,
    "",
    "## Что делаем",
    "",
    "- Определяем перечень документов на продукцию (сертификат / декларация / СГР и др.)",
    "- Оформляем документы через аккредитованные органы и лаборатории",
    "- Внесение в реестр ФСА (Росаккредитация) где требуется",
    "- Техническая документация (ТУ, руководства, паспорта и др.)",
    "- Бесплатная первичная консультация без обязательств",
    "",
    `Цены указаны «от»; точная стоимость — после анализа продукции. Калькулятор: ${base}/kalkulyator`,
    "",
    "## Услуги",
    "",
  ];

  for (const s of services) {
    parts.push(`### ${s.title}`);
    parts.push("");
    if (s.priceFrom) parts.push(`Стоимость: ${s.priceFrom}`);
    parts.push("");
    parts.push(s.description.trim());
    if (s.features?.length) {
      parts.push("");
      parts.push("Этапы / состав:");
      for (const f of s.features) parts.push(`- ${f}`);
    }
    parts.push("");
    parts.push(`Страница: ${base}/uslugi/${s.slug}`);
    parts.push("");
  }

  parts.push("## Продукция", "");
  for (const c of categories) {
    parts.push(`### ${c.title}`);
    parts.push("");
    if (c.description) parts.push(c.description.trim());
    parts.push("");
    parts.push(`Страница: ${base}/produkciya/${c.slug}`);
    parts.push("");
  }

  if (faq.length) {
    parts.push("## FAQ", "");
    for (const item of faq) {
      parts.push(`### ${item.question}`);
      parts.push("");
      parts.push(item.answer.trim());
      parts.push("");
    }
  }

  if (articles.length) {
    parts.push("## Статьи", "");
    for (const a of articles) {
      parts.push(
        link(
          a.title,
          `${base}/blog/${a.slug}`,
          a.excerpt?.trim() || a.seo?.description?.slice(0, 120)
        )
      );
    }
    parts.push("");
  }

  parts.push(
    "## Контакты",
    "",
    `Заявка на сайте: ${base}/#kontakty`,
    `Калькулятор: ${base}/kalkulyator`,
    `Телефон: ${site.phone}`,
    `Email: ${site.email}`,
    ""
  );

  return `${parts.join("\n")}\n`;
}

export function llmsTxtResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
