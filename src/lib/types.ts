export interface SiteConfig {
  name: string;
  tagline: string;
  description: string;
  phone: string;
  phoneRaw: string;
  email: string;
  owner: string;
  inn: string;
  ogrn: string;
  copyright: string;
  year: number;
  logoMark?: string;
  ogImage?: string;
  images?: {
    hero: string;
  };
  social: {
    telegram: string;
    whatsapp: string;
    max: string;
  };
  address?: {
    locality: string;
    region: string;
    country?: string;
  };
  hero: {
    title: string;
    subtitle: string;
    cta: string;
    priceFrom: string;
  };
  analytics?: {
    yandexMetrikaId?: string;
    chaportAppId?: string;
  };
  notifications?: {
    telegramEnabled?: boolean;
  };
  seo: {
    title: string;
    description: string;
    keywords: string;
  };
}

export interface CaseStudy {
  id: string;
  title: string;
  description: string;
  metric: string;
  metricLabel: string;
  secondMetric: string;
  secondMetricLabel: string;
  serviceSlug?: string;
}

export interface QuizOption {
  value: string;
  label: string;
}

export interface QuizStep {
  id: string;
  question: string;
  options: QuizOption[];
}

export interface QuizResult {
  title: string;
  description: string;
  serviceSlug?: string;
}

export interface QuizConfig {
  title: string;
  subtitle: string;
  steps: QuizStep[];
  results: Record<string, QuizResult>;
}

export interface Advantage {
  id: string;
  title: string;
  description: string;
  icon: string;
  image?: string;
}

export interface ClientLogo {
  name: string;
  logo: string;
}

export interface Step {
  number: string;
  title: string;
  description: string;
}

export interface WhyUsItem {
  number: string;
  title: string;
  description: string;
}

export interface Service {
  slug: string;
  title: string;
  shortTitle: string;
  icon: string;
  image?: string;
  priceFrom: string;
  description: string;
  features: string[];
  seo: {
    title: string;
    description: string;
  };
}

export interface Category {
  slug: string;
  title: string;
  description: string;
  /** Основной текст страницы (Markdown): заголовки, списки, жирный. */
  body?: string;
  documents: string[];
  seo: {
    title: string;
    description: string;
  };
}

export interface Article {
  slug: string;
  title: string;
  /** Краткое описание для карточек и SEO */
  excerpt: string;
  /** Основной текст (HTML из редактора; старые статьи могут быть в Markdown) */
  body: string;
  /** Обложка для карточки и Open Graph */
  image?: string;
  /** Дата публикации (YYYY-MM-DD). Статья появится на сайте в этот день, если не черновик */
  publishedAt: string;
  updatedAt?: string;
  /** Черновик — не показывается на сайте */
  draft?: boolean;
  seo: {
    title: string;
    description: string;
  };
}

export interface Review {
  id: string;
  category: string;
  text: string;
  author: string;
  location: string;
  role: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  message?: string;
  service?: string;
  source: string;
  createdAt: string;
  clientTimezone?: string;
}
