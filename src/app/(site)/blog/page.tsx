import type { Metadata } from "next";
import { getPublishedArticles } from "@/lib/content";
import { articlesIndexPath, articlePageUrl } from "@/lib/articles-routes";
import { SectionHeading } from "@/components/SectionHeading";
import { ArticlesSearchList } from "@/components/blog/ArticlesSearchList";

export const metadata: Metadata = {
  title: "Статьи о сертификации",
  description:
    "Полезные материалы о сертификации продукции: декларации, сертификаты ЕАЭС, сроки и стоимость оформления документов.",
  alternates: {
    canonical: articlesIndexPath(),
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
  openGraph: {
    title: "Статьи о сертификации | Нависерт",
    description:
      "Экспертные материалы о сертификации продукции и оформлении документов.",
    url: articlesIndexPath(),
  },
};

export default function ArticlesPage() {
  const articles = getPublishedArticles();

  const listJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Статьи о сертификации",
    itemListElement: articles.map((article, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: articlePageUrl(article.slug),
      name: article.title,
    })),
  };

  return (
    <>
      {articles.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(listJsonLd) }}
        />
      )}
      <div className="section surface-muted">
        <div className="container-page">
          <SectionHeading
            headingLevel="h1"
            title="Статьи и материалы"
            description="Разбираем сертификацию простым языком: сроки, документы, стоимость и типичные ошибки."
          />

          <ArticlesSearchList articles={articles} />
        </div>
      </div>
    </>
  );
}
