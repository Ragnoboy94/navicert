import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getServices, getSite } from "@/lib/content";
import { SectionHeading } from "@/components/SectionHeading";
import { ContactForm } from "@/components/ContactForm";
import { ServicePrice } from "@/components/ServicePrice";

const site = getSite();

export const metadata: Metadata = {
  title: "Услуги по сертификации — стоимость",
  description:
    "Полный перечень услуг центра сертификации Нависерт с ценами «от»: сертификаты ЕАЭС, декларации, ИСО, СГР, пожарная безопасность и другие документы.",
  alternates: { canonical: "/uslugi" },
  openGraph: {
    title: "Услуги по сертификации — стоимость | Нависерт",
    description:
      "Сертификаты ЕАЭС, декларации, ИСО, СГР и другие документы с указанием стоимости «от».",
  },
};

export default function ServicesPage() {
  const services = getServices();

  return (
    <div className="section surface-white">
      <div className="container-page">
        <SectionHeading
          headingLevel="h1"
          title="Услуги по сертификации"
          description="Оформим все необходимые документы — от анализа до регистрации в реестре. Указана стоимость каждой услуги."
        />

        <div className="mt-12 space-y-4">
          {services.map((service) => (
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
                <p className="mt-1 text-sm text-muted line-clamp-1">
                  {service.description}
                </p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted transition group-hover:text-primary" />
            </Link>
          ))}
        </div>

        <div className="mt-16 rounded-2xl border border-border bg-card p-8">
          <h2 className="text-xl font-bold">Не нашли нужную услугу?</h2>
          <p className="mt-2 text-muted">
            Свяжитесь с нами — проконсультируем бесплатно. Телефон:{" "}
            <a href={`tel:${site.phoneRaw}`} className="text-primary font-medium">
              {site.phone}
            </a>
          </p>
          <div className="mt-6 max-w-md">
            <ContactForm source="services-page" compact />
          </div>
        </div>
      </div>
    </div>
  );
}
