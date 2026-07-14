import type { Article } from "./types";

/** Безопасный парсинг YYYY-MM-DD для sitemap / RSS (пустая строка → fallback). */
export function parseArticleDate(iso: string | undefined, fallback = new Date()): Date {
  if (!iso?.trim()) return fallback;
  const parsed = new Date(iso.trim());
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function articleLastModified(article: Article): Date {
  return parseArticleDate(article.updatedAt ?? article.publishedAt);
}
