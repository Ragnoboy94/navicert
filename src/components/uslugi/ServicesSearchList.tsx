"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Service } from "@/lib/types";
import { ServicePrice } from "@/components/ServicePrice";
import { ContentSearchField } from "@/components/ContentSearchField";
import {
  createServiceFuse,
  searchServices,
  toSearchableService,
} from "@/lib/serviceSearch";

type Props = {
  services: Service[];
};

export function ServicesSearchList({ services }: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const searchable = useMemo(
    () => services.map(toSearchableService),
    [services]
  );

  const fuse = useMemo(() => createServiceFuse(searchable), [searchable]);

  const results = useMemo(
    () => searchServices(fuse, searchable, deferredQuery),
    [fuse, searchable, deferredQuery]
  );

  const isSearching = deferredQuery.trim().length > 0;
  const isPending = query !== deferredQuery;
  const isActive = focused || query.length > 0;

  return (
    <>
      <ContentSearchField
        id="services-search"
        value={query}
        onChange={setQuery}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Найти услугу по названию, описанию…"
        total={services.length}
        totalLabel="услуг"
        resultsCount={results.length}
        isSearching={isSearching}
        isPending={isPending}
        isActive={isActive}
      />

      <div className="mt-8 space-y-4 sm:mt-10">
        {results.map((service) => (
          <Link
            key={service.slug}
            href={`/uslugi/${service.slug}`}
            className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 transition hover:border-primary/30 hover:shadow-md"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-foreground group-hover:text-primary">
                  {service.title}
                </h2>
                {service.priceFrom && (
                  <ServicePrice price={service.priceFrom} size="sm" />
                )}
              </div>
              <p className="mt-1 line-clamp-1 text-sm text-muted">
                {service.description}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted transition group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </>
  );
}
