import fs from "fs";
import path from "path";
import type {
  Advantage,
  Article,
  CaseStudy,
  Category,
  ClientLogo,
  FaqItem,
  QuizConfig,
  Review,
  Service,
  SiteConfig,
  Step,
  WhyUsItem,
} from "./types";
import { isArticlePublished } from "./article-publish";

const contentDir =
  process.env.CONTENT_DIR?.trim() || path.join(process.cwd(), "content");

function readJson<T>(filename: string): T {
  const filePath = path.join(contentDir, filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function getSite(): SiteConfig {
  return readJson<SiteConfig>("site.json");
}

export function getAdvantages(): Advantage[] {
  return readJson<Advantage[]>("advantages.json");
}

export function getSteps(): Step[] {
  return readJson<Step[]>("steps.json");
}

export function getWhyUs(): WhyUsItem[] {
  return readJson<WhyUsItem[]>("why-us.json");
}

export function getServices(): Service[] {
  return readJson<Service[]>("services.json");
}

export function getService(slug: string): Service | undefined {
  return getServices().find((s) => s.slug === slug);
}

export function getCategories(): Category[] {
  return readJson<Category[]>("categories.json");
}

export function getCategory(slug: string): Category | undefined {
  return getCategories().find((c) => c.slug === slug);
}

export function getArticles(): Article[] {
  return readJson<Article[]>("articles.json");
}

export function getPublishedArticles(): Article[] {
  return getArticles()
    .filter((a) => isArticlePublished(a))
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        b.title.localeCompare(a.title, "ru")
    );
}

export function getArticle(slug: string): Article | undefined {
  const article = getArticles().find((a) => a.slug === slug);
  if (!article || !isArticlePublished(article)) return undefined;
  return article;
}

export function getLatestArticle(): Article | undefined {
  return getPublishedArticles()[0];
}

export function getReviews(): Review[] {
  return readJson<Review[]>("reviews.json");
}

export function getFaq(): FaqItem[] {
  return readJson<FaqItem[]>("faq.json");
}

export function getCities(): string[] {
  return readJson<string[]>("cities.json");
}

export function getPartners(): string[] {
  return readJson<string[]>("partners.json");
}

export function getClients(): ClientLogo[] {
  return readJson<ClientLogo[]>("clients.json");
}

export function getCases(): CaseStudy[] {
  return readJson<CaseStudy[]>("cases.json");
}

export function getQuiz(): QuizConfig {
  return readJson<QuizConfig>("quiz.json");
}

export function getPrivacyText(): string {
  const filePath = path.join(contentDir, "privacy.md");
  return fs.readFileSync(filePath, "utf-8");
}

export const contentFiles = [
  "site.json",
  "advantages.json",
  "steps.json",
  "why-us.json",
  "services.json",
  "categories.json",
  "articles.json",
  "reviews.json",
  "faq.json",
  "cities.json",
  "partners.json",
  "clients.json",
  "cases.json",
  "quiz.json",
] as const;

export type ContentFile = (typeof contentFiles)[number];

export function readContentFile(filename: string): unknown {
  if (!contentFiles.includes(filename as ContentFile)) {
    throw new Error("Invalid content file");
  }
  return readJson(filename);
}

export function writeContentFile(filename: string, data: unknown): void {
  if (!contentFiles.includes(filename as ContentFile)) {
    throw new Error("Invalid content file");
  }
  const filePath = path.join(contentDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
