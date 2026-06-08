import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getServices, getSite } from "@/lib/content";
import { SectionHeading } from "@/components/SectionHeading";
import { ContactForm } from "@/components/ContactForm";

const site = getSite();

export const metadata: Metadata = {
  title: "Услуги по сертификации",
  description:
    "Полный перечень услуг центра сертификации Нависерт: сертификаты ЕАЭС, декларации, ИСО, СГР, пожарная безопасность и другие документы.",
};

export default function ServicesPage() {
  const services = getServices();

  return (
    <div className="section surface-white">
      <div className="container-page">
        <SectionHeading
          title="Услуги по сертификации"
          description="Оформим все необходимые документы для вашей продукции — от анализа до регистрации в реестре."
        />

        <div className="mt-12 space-y-4">
          {services.map((service) => (
            <Link
              key={service.slug}
              href={`/uslugi/${service.slug}`}
              className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 transition hover:border-primary/30 hover:shadow-md"
            >
              <div>
                <h2 className="font-semibold text-foreground group-hover:text-primary">
                  {service.title}
                </h2>
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
