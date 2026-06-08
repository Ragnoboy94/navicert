import type { Metadata } from "next";
import Link from "next/link";
import { Package, ArrowRight } from "lucide-react";
import { getCategories } from "@/lib/content";
import { SectionHeading } from "@/components/SectionHeading";

export const metadata: Metadata = {
  title: "Сертифицируемая продукция",
  description:
    "Сертификация всех видов продукции: косметика, пищевая продукция, оборудование, мебель, игрушки и другие товарные группы.",
};

export default function CategoriesPage() {
  const categories = getCategories();

  return (
    <div className="section surface-muted">
      <div className="container-page">
        <SectionHeading
          title="Перечень сертифицируемой продукции"
          description="Помогаем с документами для любых товарных групп. Выберите категорию, чтобы узнать, какие документы потребуются."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/produkciya/${cat.slug}`}
              className="group rounded-xl border border-border bg-card p-6 transition hover:border-primary/30 hover:shadow-md"
            >
              <Package className="h-6 w-6 text-primary" />
              <h2 className="mt-3 font-semibold group-hover:text-primary">
                {cat.title}
              </h2>
              <p className="mt-2 text-sm text-muted line-clamp-2">
                {cat.description}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Подробнее
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
