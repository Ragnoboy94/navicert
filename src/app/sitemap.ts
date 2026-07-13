import type { MetadataRoute } from "next";
import { getServices, getCategories, getPublishedArticles } from "@/lib/content";
import { articlePageUrl, articlesIndexUrl } from "@/lib/articles-routes";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://navicert.pro";

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/uslugi`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/produkciya`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: articlesIndexUrl(), lastModified: new Date(), changeFrequency: "weekly", priority: 0.85 },
    { url: `${baseUrl}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];

  const servicePages = getServices().map((s) => ({
    url: `${baseUrl}/uslugi/${s.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const categoryPages = getCategories().map((c) => ({
    url: `${baseUrl}/produkciya/${c.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const articlePages = getPublishedArticles().map((a) => ({
    url: articlePageUrl(a.slug),
    lastModified: new Date(a.updatedAt ?? a.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.75,
  }));

  return [...staticPages, ...servicePages, ...categoryPages, ...articlePages];
}
