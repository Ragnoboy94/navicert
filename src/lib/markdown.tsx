import type { ReactNode } from "react";

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>;
    }
    return part ? <span key={`${keyPrefix}-t${i}`}>{part}</span> : null;
  });
}

/** Простой Markdown: ## заголовки, абзацы, списки, **жирный**. */
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
          <li key={i}>{parseInline(item.replace(/^- /, ""), `li${key}-${i}`)}</li>
        ))}
      </ul>
    );
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trimEnd();

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
      elements.push(
        <p key={key++}>{parseInline(trimmed, `p${key}`)}</p>
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
