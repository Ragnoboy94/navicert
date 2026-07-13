import { MarkdownContent } from "@/lib/markdown";
import { isArticleHtml, sanitizeArticleHtml } from "@/lib/article-body";

export function ArticleBodyContent({
  text,
  className = "prose-content",
}: {
  text: string;
  className?: string;
}) {
  if (!text.trim()) return null;

  if (isArticleHtml(text)) {
    const html = sanitizeArticleHtml(text);
    return (
      <div
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return <MarkdownContent text={text} className={className} />;
}
