import { NEW_REG_OKVED_CODES } from "./new-reg-okved-data";

const OKVED_CODE_RE = /^(\d{2}(?:\.\d{1,2}){0,3})\b/;

/** Достаёт код ОКВЭД из строки вида `14.13 — Производство…` / `14.13.1`. */
export function extractOkvedCode(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\u00a0/g, " ");
  const m = trimmed.match(OKVED_CODE_RE);
  return m?.[1] ?? null;
}

function buildAllowedSet(codes: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of codes) {
    const code = extractOkvedCode(raw);
    if (code) set.add(code);
  }
  return set;
}

const DEFAULT_ALLOWED = buildAllowedSet(NEW_REG_OKVED_CODES);

/**
 * Код подходит, если он сам в allowlist или является дочерним
 * (14.13 → 14.13.1). Родитель более узкого кода не проходит.
 */
export function matchesAllowedOkved(
  value: string | null | undefined,
  allowed: Set<string> = DEFAULT_ALLOWED
): boolean {
  const code = extractOkvedCode(value);
  if (!code || allowed.size === 0) return false;

  let cur = code;
  for (;;) {
    if (allowed.has(cur)) return true;
    const dot = cur.lastIndexOf(".");
    if (dot < 0) return false;
    cur = cur.slice(0, dot);
  }
}

/** ОКВЭД из полей очереди checko (productGroup / productName). */
export function declarationOkvedText(item: {
  productGroup?: string;
  productName?: string;
}): string | undefined {
  const group = item.productGroup?.trim();
  if (group && group !== "Новая организация") return group;
  const name = item.productName?.trim();
  if (name && name !== "Новая организация") return name;
  return group || name || undefined;
}

export function hasKnownOkved(item: {
  productGroup?: string;
  productName?: string;
}): boolean {
  return extractOkvedCode(declarationOkvedText(item)) !== null;
}

export function isAllowedNewRegOkved(item: {
  productGroup?: string;
  productName?: string;
}): boolean {
  return matchesAllowedOkved(declarationOkvedText(item));
}

export function getNewRegOkvedAllowedSet(): Set<string> {
  return DEFAULT_ALLOWED;
}
