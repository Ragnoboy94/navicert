import type { Metadata } from "next";
import { getCategories } from "@/lib/content";
import { SectionHeading } from "@/components/SectionHeading";
import { CategoriesSearchList } from "@/components/produkciya/CategoriesSearchList";

export const metadata: Metadata = {
  title: "Сертифицируемая продукция",
  description:
    "Сертификация всех видов продукции: косметика, пищевая продукция, оборудование, мебель, игрушки и другие товарные группы. Узнайте стоимость оформления документов.",
  alternates: { canonical: "/produkciya" },
  openGraph: {
    title: "Сертифицируемая продукция | Нависерт",
    description:
      "Документы для косметики, пищевой продукции, оборудования, мебели, игрушек и других товарных групп.",
    url: "/produkciya",
  },
};

export default function CategoriesPage() {
  const categories = getCategories();

  return (
    <div className="section surface-muted">
      <div className="container-page">
        <SectionHeading
          headingLevel="h1"
          title="Перечень сертифицируемой продукции"
          description="Помогаем с документами для любых товарных групп. Выберите категорию, чтобы узнать, какие документы потребуются."
        />

        <CategoriesSearchList categories={categories} />
      </div>
    </div>
  );
}
