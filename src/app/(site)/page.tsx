import { Hero } from "@/components/home/Hero";
import { ServicesSection } from "@/components/home/ServicesSection";
import { CategoriesGrid } from "@/components/home/CategoriesGrid";
import { TrustWhy } from "@/components/home/TrustWhy";
import { Steps } from "@/components/home/Steps";
import { Cities } from "@/components/home/Cities";
import { Clients } from "@/components/home/Clients";
import { Cases } from "@/components/home/Cases";
import { Reviews } from "@/components/home/Reviews";
import { Faq } from "@/components/home/Faq";
import { LatestArticle } from "@/components/home/LatestArticle";
import { ContactSection } from "@/components/home/ContactSection";
import type { Metadata } from "next";
import {
  getSite,
  getServices,
  getCategories,
  getAdvantages,
  getSteps,
  getWhyUs,
  getCities,
  getClients,
  getReviews,
  getFaq,
  getCases,
  getQuiz,
  getLatestArticle,
} from "@/lib/content";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  description:
    "Сертификация продукции под ключ: сертификаты и декларации ЕАЭС. Стоимость от 4 000 ₽. Бесплатная консультация по всей России.",
};

export default function HomePage() {
  const site = getSite();
  const services = getServices();
  const latestArticle = getLatestArticle();

  return (
    <>
      <Hero site={site} />
      <ServicesSection services={services} />
      <CategoriesGrid categories={getCategories()} />
      <TrustWhy advantages={getAdvantages()} whyUs={getWhyUs()} />
      <Steps steps={getSteps()} />
      <Cities cities={getCities()} />
      <Clients clients={getClients()} />
      <Cases cases={getCases()} />
      {latestArticle && <LatestArticle article={latestArticle} />}
      <Reviews reviews={getReviews()} />
      <Faq items={getFaq()} />
      <ContactSection site={site} quiz={getQuiz()} />
    </>
  );
}
