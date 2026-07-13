/** Публичный URL раздела статей (SEO: короткий, понятный для поисковиков) */
export const ARTICLES_PATH = "/blog" as const;

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://navicert.pro";
}

export function articlesIndexPath(): string {
  return ARTICLES_PATH;
}

export function articlePagePath(slug: string): string {
  return `${ARTICLES_PATH}/${slug}`;
}

export function articlesIndexUrl(): string {
  return `${getSiteUrl()}${ARTICLES_PATH}`;
}

export function articlePageUrl(slug: string): string {
  return `${getSiteUrl()}${ARTICLES_PATH}/${slug}`;
}
