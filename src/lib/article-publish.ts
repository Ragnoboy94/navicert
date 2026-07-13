import type { Article } from "./types";

const PUBLISH_TIMEZONE = "Europe/Moscow";

export type ArticlePublishStatus = "draft" | "scheduled" | "published";

/** Сдвиг календарной даты YYYY-MM-DD (для тестов и админки) */
export function shiftDateIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** Сегодняшняя дата для отложенной публикации (YYYY-MM-DD, Москва) */
export function todayDateIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PUBLISH_TIMEZONE,
  }).format(now);
}

export function getArticlePublishStatus(
  article: Article,
  today = todayDateIso()
): ArticlePublishStatus {
  if (article.draft) return "draft";
  if (article.publishedAt > today) return "scheduled";
  return "published";
}

/** Видна на сайте, в sitemap, RSS и SEO */
export function isArticlePublished(
  article: Article,
  today = todayDateIso()
): boolean {
  return getArticlePublishStatus(article, today) === "published";
}

/** DD.MM.YYYY для подписей в админке */
export function formatPublishDateRu(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}
