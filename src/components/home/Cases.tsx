import Link from "next/link";
import { ArrowRight, TrendingUp } from "lucide-react";
import type { CaseStudy } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";

export function Cases({ cases }: { cases: CaseStudy[] }) {
  return (
    <section id="keysy" className="section-compact surface-muted">
      <div className="container-page">
        <SectionHeading
          label="Результаты"
          title="Кейсы с цифрами"
          description="Реальные сроки и результаты — без пустых обещаний."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {cases.map((item) => (
            <article key={item.id} className="card flex flex-col p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <TrendingUp className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-bold leading-snug">{item.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
                {item.description}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-5">
                <div>
                  <p className="text-xl font-bold text-primary">{item.metric}</p>
                  <p className="text-xs text-muted">{item.metricLabel}</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-primary">
                    {item.secondMetric}
                  </p>
                  <p className="text-xs text-muted">{item.secondMetricLabel}</p>
                </div>
              </div>
              {item.serviceSlug && (
                <Link
                  href={`/uslugi/${item.serviceSlug}`}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent"
                >
                  Подробнее об услуге
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
