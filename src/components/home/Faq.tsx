import { ChevronDown } from "lucide-react";
import type { FaqItem } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <section id="faq" className="section-compact surface-muted">
      <div className="container-page">
        <SectionHeading label="FAQ" title="Вопросы и ответы" />

        <div className="mx-auto mt-8 flex max-w-3xl flex-col gap-3">
          {items.map((item) => (
            <details key={item.question} className="card group overflow-hidden">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 font-semibold leading-snug text-foreground marker:content-none hover:bg-accent-soft/30 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">{item.question}</span>
                <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted">
                {item.answer}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
