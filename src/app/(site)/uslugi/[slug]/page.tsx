import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { getServices, getService, getSite } from "@/lib/content";
import { ContactForm } from "@/components/ContactForm";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ServicePrice } from "@/components/ServicePrice";
import { parsePriceRub } from "@/lib/seo";

export function generateStaticParams() {
  return getServices().map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const service = getService(slug);
  if (!service) return {};

  return {
    title: service.seo.title,
    description: service.seo.description,
    alternates: { canonical: `/uslugi/${slug}` },
    openGraph: {
      title: service.seo.title,
      description: service.seo.description,
      url: `/uslugi/${slug}`,
      type: "article",
      ...(service.image && {
        images: [{ url: service.image, alt: service.title }],
      }),
    },
  };
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = getService(slug);
  if (!service) notFound();

  const site = getSite();
  const priceValue = parsePriceRub(service.priceFrom);
  const serviceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.title,
    description: service.description,
    provider: { "@type": "Organization", name: site.name },
    ...(priceValue && {
      offers: {
        "@type": "Offer",
        priceCurrency: "RUB",
        price: priceValue,
        description: service.priceFrom,
        availability: "https://schema.org/InStock",
      },
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }}
      />

      <div className="surface-muted section-compact">
        <div className="container-page max-w-4xl">
          <Breadcrumbs
            items={[
              { label: "Главная", href: "/" },
              { label: "Услуги", href: "/uslugi" },
              { label: service.shortTitle },
            ]}
          />
          <div className="grid gap-8 lg:grid-cols-[1fr_280px] lg:items-start">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {service.title}
              </h1>
              {service.priceFrom && (
                <div className="mt-4">
                  <p className="mb-1 text-sm font-medium text-muted">
                    Стоимость оформления
                  </p>
                  <ServicePrice price={service.priceFrom} size="lg" />
                </div>
              )}
              <p className="mt-4 text-lg leading-relaxed text-muted">
                {service.description}
              </p>
            </div>
            {service.image && (
              <div className="overflow-hidden rounded-4xl shadow-lg">
                <Image
                  src={service.image}
                  alt={service.title}
                  width={280}
                  height={200}
                  className="h-48 w-full object-cover lg:h-44"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="surface-white section container-page max-w-4xl">
        <h2 className="text-xl font-bold">Что входит в услугу</h2>
        <ul className="mt-6 space-y-3">
          {service.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="text-muted">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-12 rounded-2xl border border-border bg-card p-8">
          <h2 className="text-xl font-bold">Заказать оформление</h2>
          <p className="mt-2 text-sm text-muted">
            {service.priceFrom
              ? `Ориентировочная стоимость — ${service.priceFrom}. Оставьте заявку — рассчитаем точную цену и сроки бесплатно.`
              : "Оставьте заявку — рассчитаем стоимость и сроки бесплатно."}
          </p>
          <div className="mt-6">
            <ContactForm source={`service:${slug}`} service={service.title} />
          </div>
        </div>
      </div>
    </>
  );
}
