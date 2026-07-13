import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const INLINE_RE =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~|\[([^\]]+)\]\(([^)]+)\)/g;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const HR_LINE_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const EXTERNAL_LINK_RE = /^https?:\/\//i;

/** Префикс строки: абзац с красной строкой (включается кнопкой ¶ в редакторе) */
export const ARTICLE_INDENT_PREFIX = "¶ ";

export function stripArticleIndent(line: string): {
  indent: boolean;
  text: string;
} {
  if (line.startsWith(ARTICLE_INDENT_PREFIX)) {
    return { indent: true, text: line.slice(ARTICLE_INDENT_PREFIX.length) };
  }
  return { indent: false, text: line };
}

export function toggleArticleIndent(line: string): string {
  const trimmedStart = line.trimStart();
  const leading = line.slice(0, line.length - trimmedStart.length);
  const { indent, text } = stripArticleIndent(trimmedStart);
  if (indent) return leading + text;
  return leading + (text ? ARTICLE_INDENT_PREFIX + text : ARTICLE_INDENT_PREFIX);
}

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={`${keyPrefix}-t${i++}`}>
          {text.slice(lastIndex, match.index)}
        </span>
      );
    }

    const full = match[0];
    const bold = match[1];
    const italic = match[2];
    const strike = match[3];
    const linkLabel = match[4];
    const linkHref = match[5];

    if (bold !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={`${keyPrefix}-i${i++}`}>{italic}</em>);
    } else if (strike !== undefined) {
      nodes.push(<s key={`${keyPrefix}-s${i++}`}>{strike}</s>);
    } else if (linkLabel !== undefined && linkHref !== undefined) {
      const external = EXTERNAL_LINK_RE.test(linkHref);
      nodes.push(
        <Link
          key={`${keyPrefix}-a${i++}`}
          href={linkHref}
          className="text-primary underline decoration-primary/30 underline-offset-2 transition hover:decoration-primary"
          {...(external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
        >
          {linkLabel}
        </Link>
      );
    } else {
      nodes.push(
        <span key={`${keyPrefix}-u${i++}`}>{full}</span>
      );
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <span key={`${keyPrefix}-t${i++}`}>{text.slice(lastIndex)}</span>
    );
  }

  return nodes;
}

/** Markdown: заголовки, абзацы с красной строкой, списки, **жирный**, [ссылки](url), ![картинки](url). */
export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const elements: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={key++}>
        {listItems.map((item, i) => (
          <li key={i}>
            {parseInline(item.replace(/^- /, ""), `li${key}-${i}`)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const imageMatch = trimmed.match(IMAGE_LINE_RE);

    if (imageMatch) {
      flushList();
      const alt = imageMatch[1] ?? "";
      const src = imageMatch[2] ?? "";
      elements.push(
        <figure key={key++} className="prose-figure">
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-border bg-accent-soft">
            <Image
              src={src}
              alt={alt}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 720px"
              unoptimized
            />
          </div>
          {alt ? <figcaption>{alt}</figcaption> : null}
        </figure>
      );
      continue;
    }

    if (HR_LINE_RE.test(trimmed.trim())) {
      flushList();
      elements.push(<hr key={key++} className="prose-hr" />);
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={key++}>{parseInline(trimmed.slice(4), `h3${key}`)}</h3>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={key++}>{parseInline(trimmed.slice(3), `h2${key}`)}</h2>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(
        <h1 key={key++}>{parseInline(trimmed.slice(2), `h1${key}`)}</h1>
      );
    } else if (trimmed.startsWith("- ")) {
      listItems.push(trimmed);
    } else if (trimmed.trim()) {
      flushList();
      const { indent, text } = stripArticleIndent(trimmed);
      elements.push(
        <p key={key++} className={indent ? "prose-indent" : undefined}>
          {parseInline(text, `p${key}`)}
        </p>
      );
    } else if (listItems.length > 0) {
      flushList();
    }
  }

  flushList();
  return elements;
}

export function MarkdownContent({
  text,
  className = "prose-content",
}: {
  text: string;
  className?: string;
}) {
  if (!text.trim()) return null;
  return <div className={className}>{renderMarkdown(text)}</div>;
}
