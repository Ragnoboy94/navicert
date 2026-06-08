import Link from "next/link";
import { ArrowRight, Package } from "lucide-react";
import type { Category } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";

const HOME_LIMIT = 9;

export function CategoriesGrid({ categories }: { categories: Category[] }) {
  const shown = categories.slice(0, HOME_LIMIT);

  return (
    <section className="section-compact surface-muted">
      <div className="container-page">
        <SectionHeading
          label="Продукция"
          title="Сертифицируемая продукция"
          description="Помогаем с документами для любых товарных групп."
        />

        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((cat) => (
            <Link
              key={cat.slug}
              href={`/produkciya/${cat.slug}`}
              className="group flex items-start gap-3 rounded-2xl border border-border bg-background px-4 py-4 transition hover:border-accent/40 hover:bg-accent-soft/30"
            >
              <Package className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 text-sm font-medium leading-snug text-foreground group-hover:text-primary">
                {cat.title}
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-5 text-center">
          <Link href="/produkciya" className="btn-ghost px-6 py-3 text-sm">
            Все категории
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
