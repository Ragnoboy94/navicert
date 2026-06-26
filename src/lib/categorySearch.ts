import type { Category } from "./types";
import {
  buildSearchBlob,
  createContentFuse,
  searchContent,
  stripMarkdown,
  type SearchableItem,
} from "./fuzzySearch";

export type SearchableCategory = Category & SearchableItem;

export function toSearchableCategory(category: Category): SearchableCategory {
  return {
    ...category,
    searchBlob: buildSearchBlob([
      category.title,
      stripMarkdown(category.description),
      category.body ? stripMarkdown(category.body) : "",
      ...category.documents,
      category.seo.title,
      category.seo.description,
    ]),
  };
}

export function createCategoryFuse(categories: SearchableCategory[]) {
  return createContentFuse(categories, [
    { name: "title", weight: 0.3 },
    { name: "description", weight: 0.2 },
    { name: "documents", weight: 0.2 },
    { name: "searchBlob", weight: 0.3 },
  ]);
}

export function searchCategories(
  fuse: ReturnType<typeof createCategoryFuse>,
  categories: SearchableCategory[],
  query: string
) {
  return searchContent(fuse, categories, query);
}
