"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Package } from "lucide-react";
import type { Category } from "@/lib/types";
import { ContentSearchField } from "@/components/ContentSearchField";
import {
  createCategoryFuse,
  searchCategories,
  toSearchableCategory,
} from "@/lib/categorySearch";

type Props = {
  categories: Category[];
};

export function CategoriesSearchList({ categories }: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const searchable = useMemo(
    () => categories.map(toSearchableCategory),
    [categories]
  );

  const fuse = useMemo(() => createCategoryFuse(searchable), [searchable]);

  const results = useMemo(
    () => searchCategories(fuse, searchable, deferredQuery),
    [fuse, searchable, deferredQuery]
  );

  const isSearching = deferredQuery.trim().length > 0;
  const isPending = query !== deferredQuery;
  const isActive = focused || query.length > 0;

  return (
    <>
      <ContentSearchField
        id="categories-search"
        value={query}
        onChange={setQuery}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Найти продукцию по названию, описанию…"
        total={categories.length}
        totalLabel="категорий"
        resultsCount={results.length}
        isSearching={isSearching}
        isPending={isPending}
        isActive={isActive}
      />

      <div className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((category) => (
          <Link
            key={category.slug}
            href={`/produkciya/${category.slug}`}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/30 hover:shadow-md"
          >
            {category.image ? (
              <div className="relative aspect-[16/10] bg-accent-soft">
                <Image
                  src={category.image}
                  alt=""
                  fill
                  className="object-cover transition group-hover:scale-[1.02]"
                  sizes="(max-width: 768px) 100vw, 360px"
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center bg-accent-soft text-primary">
                <Package className="h-8 w-8 opacity-60" />
              </div>
            )}
            <div className="flex flex-1 flex-col p-6">
              <h2 className="font-semibold group-hover:text-primary">
                {category.title}
              </h2>
              <p className="mt-2 line-clamp-2 text-sm text-muted">
                {category.description}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Подробнее
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
