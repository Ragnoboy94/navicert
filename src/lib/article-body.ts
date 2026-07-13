import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "p",
  "h2",
  "h3",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "a",
  "ul",
  "ol",
  "li",
  "img",
  "hr",
  "br",
];

const ALLOWED_ATTR = ["href", "src", "alt", "class", "target", "rel"];

export function isArticleHtml(body: string): boolean {
  return body.trimStart().startsWith("<");
}

/** HTML для Tiptap: готовый HTML или экранированный legacy-Markdown */
export function articleBodyToEditorHtml(body: string): string {
  const trimmed = body?.trim() || "";
  if (!trimmed) return "<p></p>";
  if (isArticleHtml(trimmed)) return trimmed;
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
}

export function isLegacyArticleMarkdown(body: string): boolean {
  return Boolean(body.trim()) && !isArticleHtml(body);
}

/** Пустые абзацы от Enter → видимая пустая строка в превью и на сайте */
export function normalizeArticleHtml(html: string): string {
  return html
    .replace(/<p><br class="ProseMirror-trailingBreak"><\/p>/gi, "<p><br></p>")
    .replace(/<p>(\s|&nbsp;|&#160;)*<\/p>/gi, "<p><br></p>");
}

export function sanitizeArticleHtml(html: string): string {
  const normalized = normalizeArticleHtml(html);
  return DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ["target", "rel"],
  });
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
