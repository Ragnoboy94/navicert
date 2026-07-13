"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, FileText } from "lucide-react";
import type { Article } from "@/lib/types";
import { articlePagePath } from "@/lib/articles-routes";
import { ContentSearchField } from "@/components/ContentSearchField";
import {
  createArticleFuse,
  searchArticles,
  toSearchableArticle,
} from "@/lib/articleSearch";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type Props = {
  articles: Article[];
};

export function ArticlesSearchList({ articles }: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const searchable = useMemo(
    () => articles.map(toSearchableArticle),
    [articles]
  );

  const fuse = useMemo(() => createArticleFuse(searchable), [searchable]);

  const results = useMemo(
    () => searchArticles(fuse, searchable, deferredQuery),
    [fuse, searchable, deferredQuery]
  );

  const isSearching = deferredQuery.trim().length > 0;
  const isPending = query !== deferredQuery;
  const isActive = focused || query.length > 0;

  if (articles.length === 0) {
    return (
      <p className="py-12 text-center text-muted">
        Статей пока нет — загляните позже.
      </p>
    );
  }

  return (
    <>
      <ContentSearchField
        id="articles-search"
        value={query}
        onChange={setQuery}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Найти статью по названию или тексту…"
        total={articles.length}
        totalLabel="статей"
        resultsCount={results.length}
        isSearching={isSearching}
        isPending={isPending}
        isActive={isActive}
      />

      <div className="mt-8 grid gap-5 sm:mt-10 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((article) => (
          <Link
            key={article.slug}
            href={articlePagePath(article.slug)}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/30 hover:shadow-md"
          >
            {article.image ? (
              <div className="relative aspect-[16/10] bg-accent-soft">
                <Image
                  src={article.image}
                  alt=""
                  fill
                  className="object-cover transition group-hover:scale-[1.02]"
                  sizes="(max-width: 768px) 100vw, 360px"
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center bg-accent-soft text-primary">
                <FileText className="h-10 w-10 opacity-60" />
              </div>
            )}
            <div className="flex flex-1 flex-col p-5">
              <time
                dateTime={article.publishedAt}
                className="text-xs font-medium text-muted"
              >
                {formatDate(article.publishedAt)}
              </time>
              <h2 className="mt-2 font-semibold leading-snug group-hover:text-primary">
                {article.title}
              </h2>
              <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted">
                {article.excerpt}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Читать
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
