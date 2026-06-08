import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Service } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";

const FEATURED_SLUGS = [
  "deklaratsiya-sootvetstviya-eaes",
  "sertifikat-sootvetstviya-eaes",
  "razrabotka-tehnicheskoy-dokumentatsii",
];

const COMPACT_LIMIT = 8;

export function ServicesSection({ services }: { services: Service[] }) {
  const featured = FEATURED_SLUGS.map(
    (slug) => services.find((s) => s.slug === slug)!
  ).filter(Boolean);

  const compact = services
    .filter((s) => !FEATURED_SLUGS.includes(s.slug))
    .slice(0, COMPACT_LIMIT);

  return (
    <section id="uslugi" className="section-compact surface-white">
      <div className="container-page">
        <SectionHeading
          label="Услуги"
          title="Популярные направления"
          description="Три ключевых документа и полный перечень — оформим под ключ."
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
                  <Image
                    src={service.image}
                    alt={service.title}
                    fill
                    className="object-cover transition duration-500 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    loading="lazy"
                  />
                </div>
              )}
              <div className="p-4 sm:p-5">
                <h3 className="text-base font-bold leading-snug text-foreground group-hover:text-primary sm:text-lg">
                  {service.shortTitle}
                </h3>
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
              className="group flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium transition hover:border-accent/40 hover:bg-accent-soft/30"
            >
              <span className="min-w-0 truncate text-foreground group-hover:text-primary">
                {service.shortTitle}
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
