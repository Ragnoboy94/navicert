import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Shield, Clock, MapPin } from "lucide-react";
import type { SiteConfig } from "@/lib/types";

export function Hero({ site }: { site: SiteConfig }) {
  const heroImage = site.images?.hero ?? "/images/hero-main.webp";

  return (
    <section className="surface-blue relative overflow-hidden text-white">
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
      <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />

      <div className="container-page relative grid items-center gap-8 py-12 lg:grid-cols-2 lg:gap-12 lg:py-16">
        <div className="max-w-xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur">
            <Shield className="h-4 w-4 text-accent" />
            Центр сертификации · опыт 12+ лет
          </p>
          <h1 className="text-[clamp(1.875rem,4.5vw,3.25rem)] font-bold leading-[1.15] tracking-tight">
            {site.hero.title}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-blue-100 sm:text-lg">
            {site.hero.subtitle}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#zayavka" className="btn-primary px-6 py-3.5 text-sm">
              {site.hero.cta}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/uslugi" className="btn-outline px-6 py-3.5 text-sm">
              Все услуги
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-blue-100">
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <Clock className="h-4 w-4 shrink-0 text-accent" />
              {site.hero.priceFrom}
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-accent" />
              Работаем по всей России
            </span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="overflow-hidden rounded-4xl shadow-2xl shadow-black/25 ring-1 ring-white/10">
            <Image
              src={heroImage}
              alt="Документы сертификации продукции"
              width={640}
              height={480}
              className="aspect-[4/3] w-full object-cover"
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
