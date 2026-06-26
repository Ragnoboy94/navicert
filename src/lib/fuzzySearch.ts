import Fuse, { type IFuseOptions } from "fuse.js";

const STOP_WORDS = new Set([
  "для",
  "и",
  "в",
  "во",
  "на",
  "по",
  "с",
  "со",
  "из",
  "от",
  "до",
  "при",
  "или",
  "как",
  "что",
  "это",
  "а",
  "но",
  "не",
  "без",
  "под",
  "над",
  "об",
  "о",
  "у",
  "к",
  "же",
  "ли",
  "бы",
  "типа",
  "применение",
  "использование",
  "контракт",
  "контрактов",
  "контракты",
  "документ",
  "документы",
  "оформление",
  "получение",
  "нужен",
  "нужна",
  "нужно",
  "можно",
  "если",
  "когда",
  "где",
  "кто",
  "чем",
  "такой",
  "такая",
  "такие",
  "все",
  "всё",
  "всех",
  "любой",
  "любая",
  "любые",
]);

const TOKEN_ALIASES: Record<string, string[]> = {
  гес: ["гис", "фгис"],
  гис: ["гис", "фгис"],
  фгис: ["фгис", "гис"],
  fgis: ["фгис", "гис"],
  гост: ["гост"],
  еаэс: ["еаэс"],
  eac: ["еаэс"],
  iso: ["исо"],
  исо: ["исо"],
  сгр: ["сгр"],
  ту: ["ту", "технические условия"],
};

const MATCH_SCORE = 0.52;

export type SearchableItem = {
  slug: string;
  searchBlob: string;
};

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/[#*_`>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function enrichSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/фгис/g, "фгис гис")
    .replace(/еаэс/g, "еаэс eac")
    .replace(/гост\s*р/g, "гост р gost");
}

export function buildSearchBlob(parts: string[]): string {
  return enrichSearchText(parts.filter(Boolean).join("\n"));
}

export function tokenizeSearchQuery(query: string): string[] {
  return enrichSearchText(query)
    .split(/[\s,;.:!?()[\]«»"']+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

function expandToken(token: string): string[] {
  const aliases = TOKEN_ALIASES[token];
  if (!aliases) return [token];
  return [...new Set([token, ...aliases])];
}

function blobContainsVariant(blob: string, variant: string): boolean {
  if (blob.includes(variant)) return true;
  if (variant.length < 4) return false;

  const roots = [variant.slice(0, -1), variant.slice(0, -2)].filter(
    (root) => root.length >= 4
  );
  return roots.some((root) => blob.includes(root));
}

function matchToken<T extends SearchableItem>(
  fuse: Fuse<T>,
  items: T[],
  token: string
): Set<string> {
  const matched = new Set<string>();

  for (const variant of expandToken(token)) {
    for (const result of fuse.search(variant)) {
      if ((result.score ?? 1) <= MATCH_SCORE) {
        matched.add(result.item.slug);
      }
    }

    for (const item of items) {
      if (blobContainsVariant(item.searchBlob, variant)) {
        matched.add(item.slug);
      }
    }
  }

  return matched;
}

export function createContentFuse<T extends SearchableItem>(
  items: T[],
  keys: IFuseOptions<T>["keys"]
) {
  return new Fuse(items, {
    keys,
    threshold: 0.42,
    distance: 120,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
}

export function searchContent<T extends SearchableItem>(
  fuse: Fuse<T>,
  items: T[],
  query: string
): T[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  const tokens = tokenizeSearchQuery(trimmed);
  if (tokens.length === 0) return items;

  let matchedSlugs = new Set(items.map((item) => item.slug));

  for (const token of tokens) {
    const tokenMatches = matchToken(fuse, items, token);
    matchedSlugs = new Set(
      [...matchedSlugs].filter((slug) => tokenMatches.has(slug))
    );
    if (matchedSlugs.size === 0) break;
  }

  const order = new Map(items.map((item, index) => [item.slug, index]));
  return items
    .filter((item) => matchedSlugs.has(item.slug))
    .sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
}
