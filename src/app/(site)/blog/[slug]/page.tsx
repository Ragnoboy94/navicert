import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getArticle, getPublishedArticles, getSite } from "@/lib/content";
import {
  articlePagePath,
  articlePageUrl,
  articlesIndexPath,
  getSiteUrl,
} from "@/lib/articles-routes";
import { ArticleBodyContent } from "@/components/ArticleBodyContent";
import { ContactForm } from "@/components/ContactForm";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export function generateStaticParams() {
  return getPublishedArticles().map((a) => ({ slug: a.slug }));
}

export const dynamicParams = true;

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return {};

  const images = article.image
    ? [{ url: article.image, alt: article.title }]
    : undefined;

  return {
    title: article.seo.title,
    description: article.seo.description,
    alternates: { canonical: articlePagePath(slug) },
    openGraph: {
      title: article.seo.title,
      description: article.seo.description,
      url: articlePagePath(slug),
      type: "article",
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt ?? article.publishedAt,
      images,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const site = getSite();
  const baseUrl = getSiteUrl();

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt ?? article.publishedAt,
    author: {
      "@type": "Organization",
      name: site.name,
    },
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: baseUrl,
    },
    mainEntityOfPage: articlePageUrl(slug),
    ...(article.image ? { image: [`${baseUrl}${article.image}`] } : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <div>
        <div className="surface-muted section-compact">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <Breadcrumbs
              items={[
                { label: "Главная", href: "/" },
                { label: "Статьи", href: articlesIndexPath() },
                { label: article.title },
              ]}
            />
            <time
              dateTime={article.publishedAt}
              className="mt-4 block text-sm font-medium text-muted"
            >
              {formatDate(article.publishedAt)}
            </time>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              {article.title}
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              {article.excerpt}
            </p>
          </div>
        </div>

        {article.image && (
          <div className="surface-white section-compact">
            <div className="container-page max-w-3xl">
              <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-border bg-accent-soft">
                <Image
                  src={article.image}
                  alt=""
                  fill
                  className="object-cover"
                  priority
                  sizes="(max-width: 768px) 100vw, 720px"
                  unoptimized
                />
              </div>
            </div>
          </div>
        )}

        <div className="surface-white section container-page max-w-3xl">
          <ArticleBodyContent text={article.body} />

          <div className="mt-12 rounded-2xl border border-border bg-card p-8">
            <h2 className="text-xl font-bold">Нужна консультация?</h2>
            <p className="mt-2 text-sm text-muted">
              Подскажем, какие документы нужны именно для вашей продукции.
            </p>
            <div className="mt-6">
              <ContactForm
                source={`article:${slug}`}
                service={article.title}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
