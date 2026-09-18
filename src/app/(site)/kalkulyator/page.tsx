import type { Metadata } from "next";
import { CalculatorClient } from "@/components/CalculatorClient";
import { getQuiz, getSite } from "@/lib/content";

export const metadata: Metadata = {
  title: "Калькулятор документов для сертификации",
  description:
    "За 2 вопроса подскажем, какой документ нужен для вашей продукции, и рассчитаем оформление. Бесплатная консультация Нависерт.",
  alternates: { canonical: "/kalkulyator" },
  openGraph: {
    title: "Калькулятор сертификации | Нависерт",
    description:
      "Подберите документ для продукции и оставьте заявку на расчёт стоимости.",
    url: "/kalkulyator",
  },
};

export default function CalculatorPage() {
  const quiz = getQuiz();
  const site = getSite();

  return (
    <CalculatorClient
      quiz={quiz}
      phone={site.phone}
      phoneRaw={site.phoneRaw}
      email={site.email}
      social={site.social}
    />
  );
}
