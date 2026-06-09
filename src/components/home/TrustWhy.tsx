import Image from "next/image";
import { ChevronDown } from "lucide-react";
import type { Advantage, WhyUsItem } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";

export function TrustWhy({
  advantages,
  whyUs,
}: {
  advantages: Advantage[];
  whyUs: WhyUsItem[];
}) {
  return (
    <section id="preimuschestva" className="section surface-muted">
      <div className="container-page">
        <SectionHeading
          label="Почему мы"
          title="Нависерт — надёжный партнёр"
          description="Опыт, прозрачность и работа по всей России."
        />

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {whyUs.map((item) => (
            <div
              key={item.number}
              className="rounded-2xl bg-gradient-to-br from-primary-dark to-primary p-5 text-white"
            >
              <span className="text-2xl font-bold text-white/25">
                {item.number}
              </span>
              <h3 className="mt-2 text-sm font-bold leading-snug sm:text-base">
                {item.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-blue-100 sm:text-sm">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        <details className="group mt-6 card overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold marker:content-none hover:bg-accent-soft/20 [&::-webkit-details-marker]:hidden">
            <span>Ещё преимущества</span>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">
            {advantages.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-xl bg-background p-3">
                {item.image && (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft p-1.5">
                    <Image
                      src={item.image}
                      alt={item.title}
                      width={32}
                      height={32}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="text-sm font-bold leading-snug">{item.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
