import { getPublishedArticles, getSite } from "@/lib/content";
import {
  articlePageUrl,
  articlesIndexUrl,
  getSiteUrl,
} from "@/lib/articles-routes";
import { excerptFromBody } from "@/lib/seo-content";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const site = getSite();
  const baseUrl = getSiteUrl();
  const articles = getPublishedArticles().slice(0, 50);

  const items = articles
    .map((article) => {
      const link = articlePageUrl(article.slug);
      const pubDate = new Date(article.publishedAt).toUTCString();
      const description =
        article.excerpt.trim() ||
        article.seo.description.trim() ||
        excerptFromBody(article.body);
      return `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${escapeXml(description)}</description>
      <pubDate>${pubDate}</pubDate>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)} — статьи</title>
    <link>${articlesIndexUrl()}</link>
    <description>${escapeXml("Статьи о сертификации продукции")}</description>
    <language>ru</language>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
