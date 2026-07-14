"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import type { Article } from "@/lib/types";
import {
  buildArticleSeoFromContent,
  excerptFromBody,
  uniqueSlug,
} from "@/lib/seo-content";
import {
  getArticlePublishStatus,
  isArticlePublished,
  formatPublishDateRu,
  todayDateIso,
} from "@/lib/article-publish";
import {
  articlePagePath,
  articlesIndexPath,
} from "@/lib/articles-routes";
import { loadContent, saveContent } from "./api";
import { ArticleRichEditor } from "./ArticleRichEditor";
import { ImageUpload } from "./ImageUpload";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";

function emptyArticle(slug: string, title: string): Article {
  return {
    slug,
    title,
    excerpt: "",
    body: "",
    publishedAt: todayDateIso(),
    draft: true,
    seo: buildArticleSeoFromContent(title, "", ""),
  };
}

function publishStatusHint(article: Article): { tone: string; text: string } {
  const status = getArticlePublishStatus(article);
  if (status === "draft") {
    return {
      tone: "border-amber-200 bg-amber-50 text-amber-950",
      text: "Черновик — статья скрыта с сайта и не попадает в Google / Яндекс. Снимите галочку «Черновик» и сохраните.",
    };
  }
  if (status === "scheduled") {
    return {
      tone: "border-sky-200 bg-sky-50 text-sky-950",
      text: `Запланирована на ${formatPublishDateRu(article.publishedAt)} (00:00 МСК). После этой даты появится на сайте и в sitemap.`,
    };
  }
  return {
    tone: "border-green-200 bg-green-50 text-green-950",
    text: "Опубликована на сайте и в sitemap. Появление в Google / Яндекс обычно занимает от нескольких дней до 2 недель.",
  };
}

function saveButtonLabel(article: Article): string {
  return getArticlePublishStatus(article) === "draft"
    ? "Сохранить черновик"
    : "Сохранить и обновить на сайте";
}

function articleTabLabel(article: Article): string {
  const status = getArticlePublishStatus(article);
  if (status === "draft") return `черновик · ${article.title || "Без названия"}`;
  if (status === "scheduled") {
    return `${formatPublishDateRu(article.publishedAt)} · ${article.title || "Без названия"}`;
  }
  return article.title || "Без названия";
}

function withAutoSeo(article: Article): Article {
  const excerpt = article.excerpt.trim() || excerptFromBody(article.body);
  return {
    ...article,
    excerpt: article.excerpt.trim() ? article.excerpt : excerpt,
    seo: buildArticleSeoFromContent(article.title, excerpt, article.body),
  };
}

function normalizeArticles(list: Article[]): Article[] {
  return list.map((a) =>
    withAutoSeo({
      ...a,
      updatedAt: new Date().toISOString().slice(0, 10),
    })
  );
}

function nextOpenIndex(
  current: number | null,
  removedIndex: number,
  remaining: number
): number | null {
  if (remaining === 0) return null;
  if (current === null) return 0;
  if (current === removedIndex) return Math.min(removedIndex, remaining - 1);
  if (current > removedIndex) return current - 1;
  return current;
}

export function ArticlesEditor() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<Article[]>("articles.json").then((data) => {
      setArticles(data);
      if (data.length > 0) setOpenIndex(0);
    });
  }, []);

  function update(index: number, patch: Partial<Article>) {
    setArticles((prev) =>
      prev.map((a, i) => (i === index ? withAutoSeo({ ...a, ...patch }) : a))
    );
  }

  function updateTitle(index: number, title: string) {
    setArticles((prev) => {
      const article = prev[index];
      const otherSlugs = prev.filter((_, i) => i !== index).map((a) => a.slug);
      const newSlug = uniqueSlug(title, otherSlugs, "statya");
      return prev.map((a, i) =>
        i === index
          ? withAutoSeo({ ...a, title, slug: newSlug })
          : a
      );
    });
  }

  function addArticle() {
    setArticles((prev) => {
      const title = "Новая статья";
      const slug = uniqueSlug(
        title,
        prev.map((a) => a.slug),
        "statya"
      );
      setOpenIndex(prev.length);
      return [...prev, emptyArticle(slug, title)];
    });
  }

  async function removeArticle(index: number) {
    const article = articles[index];
    if (!article) return;

    const label = article.draft ? "черновик" : "статью";
    if (
      !confirm(
        `Удалить ${label} «${article.title}»? Это действие нельзя отменить.`
      )
    ) {
      return;
    }

    const next = articles.filter((_, i) => i !== index);
    const slugs = next.map((a) => a.slug);
    if (slugs.length !== new Set(slugs).size) {
      alert("Есть повторяющиеся адреса. Сначала исправьте названия.");
      return;
    }

    const newOpen = nextOpenIndex(openIndex, index, next.length);

    await run(async () => {
      await saveContent("articles.json", next);
      setArticles(next);
      setOpenIndex(newOpen);
    });
  }

  async function save() {
    const normalized = normalizeArticles(articles);

    const slugs = normalized.map((a) => a.slug);
    if (slugs.length !== new Set(slugs).size) {
      alert("Есть повторяющиеся адреса. Проверьте названия статей.");
      return;
    }
    if (normalized.some((a) => !a.title.trim())) {
      alert("У каждой статьи должно быть название.");
      return;
    }

    await run(async () => {
      await saveContent("articles.json", normalized);
      setArticles(normalized);
    });
  }

  if (articles.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Пишите статьи как в обычном редакторе — заголовки, списки, ссылки и
          фото. SEO подтянется само.
        </p>
        <button
          type="button"
          onClick={addArticle}
          className="btn-primary gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          Добавить статью
        </button>
      </div>
    );
  }

  const article = openIndex !== null ? articles[openIndex] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Раздел {articlesIndexPath()} · SEO формируется из заголовка и описания автоматически
        </p>
        <button
          type="button"
          onClick={addArticle}
          className="btn-primary gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          Добавить статью
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {articles.map((item, index) => (
          <button
            key={`${index}-${item.slug}`}
            type="button"
            onClick={() => setOpenIndex(index)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              openIndex === index
                ? "bg-primary text-white"
                : "border border-border bg-white text-muted hover:border-primary/30"
            }`}
          >
            {articleTabLabel(item)}
          </button>
        ))}
      </div>

      {article && openIndex !== null && (() => {
        const publishHint = publishStatusHint(article);
        return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {articlePagePath(article.slug)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {isArticlePublished(article) && (
                <Link
                  href={articlePagePath(article.slug)}
                  target="_blank"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Открыть на сайте
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => void removeArticle(openIndex)}
                disabled={status === "saving"}
                className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {status === "saving" ? "Удаление…" : "Удалить"}
              </button>
            </div>
          </div>

          <AdminCard>
            <div className="grid gap-5">
              <p className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${publishHint.tone}`}>
                {publishHint.text}
              </p>

              <Field label="Заголовок">
                <TextInput
                  value={article.title}
                  onChange={(e) => updateTitle(openIndex, e.target.value)}
                  placeholder="Например: Сертификация косметики в 2026 году"
                />
              </Field>

              <Field
                label="Краткое описание"
                hint="Для карточки, главной и поиска. Если оставить пустым — возьмём из начала текста."
              >
                <TextArea
                  value={article.excerpt}
                  onChange={(e) => update(openIndex, { excerpt: e.target.value })}
                  rows={2}
                  placeholder="О чём статья в двух предложениях"
                />
              </Field>

              <Field label="Дата публикации">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <TextInput
                    type="date"
                    value={article.publishedAt}
                    onChange={(e) =>
                      update(openIndex, { publishedAt: e.target.value })
                    }
                    className="sm:max-w-[11rem]"
                  />
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={Boolean(article.draft)}
                      onChange={(e) =>
                        update(openIndex, { draft: e.target.checked })
                      }
                      className="h-4 w-4 shrink-0 rounded border-border text-primary"
                    />
                    <span>Черновик</span>
                  </label>
                </div>
                <span className="mt-1.5 block text-xs text-muted">
                  Статья появится на сайте, в RSS и sitemap в выбранный день (с 00:00 по Москве).
                  Снимите «Черновик», чтобы запланировать или опубликовать.
                </span>
              </Field>

              <div>
                <span className="mb-1.5 block text-sm font-medium text-foreground">
                  Текст статьи
                </span>
                <ArticleRichEditor
                  key={article.slug}
                  value={article.body}
                  onChange={(body) => update(openIndex, { body })}
                  slug={article.slug}
                />
              </div>

              <details className="rounded-xl border border-border bg-background/60 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  Обложка{article.image ? "" : " (необязательно)"}
                </summary>
                <div className="mt-3">
                  <ImageUpload
                    variant="compact"
                    value={article.image}
                    onChange={(url) => update(openIndex, { image: url })}
                    name={article.slug}
                    folder="articles"
                    hint="Для карточки и соцсетей"
                  />
                </div>
              </details>

              <details className="rounded-xl border border-border bg-background/60 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  Как будет в поиске Google / Яндекс
                </summary>
                <div className="mt-3 space-y-1 text-sm">
                  <p className="font-medium text-[#1a0dab]">
                    {article.seo.title || "Заголовок статьи — Нависерт"}
                  </p>
                  <p className="text-[#006621]">navicert.pro{articlePagePath(article.slug)}</p>
                  <p className="text-muted leading-relaxed">
                    {article.seo.description ||
                      "Описание появится после заполнения текста."}
                  </p>
                </div>
              </details>
            </div>
          </AdminCard>

          <SaveButton onClick={save} status={status} label={saveButtonLabel(article)} />
        </div>
        );
      })()}
    </div>
  );
}
