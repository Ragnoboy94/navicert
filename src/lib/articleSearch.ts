import type { Article } from "./types";
import {
  buildSearchBlob,
  createContentFuse,
  searchContent,
  stripMarkdown,
  type SearchableItem,
} from "./fuzzySearch";

export type SearchableArticle = Article & SearchableItem;

export function toSearchableArticle(article: Article): SearchableArticle {
  return {
    ...article,
    searchBlob: buildSearchBlob([
      article.title,
      article.excerpt,
      stripMarkdown(article.body),
      article.seo.title,
      article.seo.description,
    ]),
  };
}

export function createArticleFuse(articles: SearchableArticle[]) {
  return createContentFuse(articles, [
    { name: "title", weight: 0.35 },
    { name: "excerpt", weight: 0.25 },
    { name: "searchBlob", weight: 0.4 },
  ]);
}

export function searchArticles(
  fuse: ReturnType<typeof createArticleFuse>,
  articles: SearchableArticle[],
  query: string
) {
  return searchContent(fuse, articles, query);
}
