import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Service } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";
import { ServicePrice } from "../ServicePrice";

const FEATURED_SLUG_PRIORITY = [
  "deklaratsiya-sootvetstviya-eaes",
  "sertifikat-sootvetstviya-eaes",
  "razrabotka-tehnicheskoy-dokumentatsii",
  // друг переименовал услугу в админке — тот же блок с картинкой
  "tehnicheskie-usloviya",
];

const COMPACT_LIMIT = 8;

function pickFeatured(services: Service[]): Service[] {
  const bySlug = new Map(services.map((s) => [s.slug, s]));
  const picked: Service[] = [];
  const used = new Set<string>();

  for (const slug of FEATURED_SLUG_PRIORITY) {
    const service = bySlug.get(slug);
    if (service && !used.has(service.slug)) {
      picked.push(service);
      used.add(service.slug);
      if (picked.length >= 3) return picked;
    }
  }

  for (const service of services) {
    if (!used.has(service.slug) && service.image) {
      picked.push(service);
      used.add(service.slug);
      if (picked.length >= 3) return picked;
    }
  }

  return picked;
}

export function ServicesSection({ services }: { services: Service[] }) {
  const featured = pickFeatured(services);

  const compact = services
    .filter((s) => !featured.some((f) => f.slug === s.slug))
    .slice(0, COMPACT_LIMIT);

  return (
    <section id="uslugi" className="section-compact surface-white">
      <div className="container-page">
        <SectionHeading
          label="Услуги"
          title="Популярные направления"
          description="Три ключевых документа и полный перечень — оформим под ключ. Указана стоимость «от»."
        />

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {featured.map((service) => (
            <Link
              key={service.slug}
              href={`/uslugi/${service.slug}`}
              className="group card overflow-hidden transition hover:shadow-[var(--shadow-hover)]"
            >
              {service.image && (
                <div className="relative aspect-[16/10] overflow-hidden bg-accent-soft">
                  {service.priceFrom && (
                    <ServicePrice
                      price={service.priceFrom}
                      size="sm"
                      className="absolute right-3 top-3 z-10 bg-white/95 shadow-sm"
                    />
                  )}
                  <Image
                    src={service.image}
                    alt={service.title}
                    fill
                    className="object-cover contrast-[1.02] saturate-[1.03] transition duration-500 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    quality={90}
                    loading="lazy"
                  />
                </div>
              )}
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-base font-bold leading-snug text-foreground group-hover:text-primary sm:text-lg">
                    {service.shortTitle}
                  </h3>
                  {!service.image && service.priceFrom && (
                    <ServicePrice price={service.priceFrom} size="sm" />
                  )}
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
                  {service.description}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent">
                  Подробнее
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {compact.map((service) => (
            <Link
              key={service.slug}
              href={`/uslugi/${service.slug}`}
              className="group flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm transition hover:border-accent/40 hover:bg-accent-soft/30"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground group-hover:text-primary">
                  {service.shortTitle}
                </span>
                {service.priceFrom && (
                  <span className="text-xs font-semibold text-primary">
                    {service.priceFrom}
                  </span>
                )}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
            </Link>
          ))}
        </div>

        <div className="mt-5 text-center">
          <Link href="/uslugi" className="btn-ghost px-5 py-2.5 text-sm">
            Все услуги
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
