import type { Metadata } from "next";
import { getServices, getSite } from "@/lib/content";
import { SectionHeading } from "@/components/SectionHeading";
import { ContactForm } from "@/components/ContactForm";
import { ServicesSearchList } from "@/components/uslugi/ServicesSearchList";

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
    url: "/uslugi",
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

        <ServicesSearchList services={services} />

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
