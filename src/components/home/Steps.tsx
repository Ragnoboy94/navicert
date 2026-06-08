import { ChevronDown } from "lucide-react";
import type { Step } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";

export function Steps({ steps }: { steps: Step[] }) {
  return (
    <section id="etapy" className="section-compact surface-white">
      <div className="container-page">
        <SectionHeading
          label="Процесс"
          title="Этапы работы"
          description="Прозрачный процесс от консультации до получения документов."
        />

        <div className="mt-8 hidden lg:grid lg:grid-cols-6 lg:gap-3">
          {steps.map((step, i) => (
            <div key={step.number} className="relative text-center">
              {i < steps.length - 1 && (
                <div className="absolute left-[calc(50%+1.5rem)] top-6 h-0.5 w-[calc(100%-3rem)] bg-border" />
              )}
              <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary-light text-sm font-bold text-white shadow-md">
                {step.number}
              </div>
              <h3 className="mt-3 text-sm font-bold leading-snug">{step.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                {step.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-2 lg:hidden">
          {steps.map((step) => (
            <details key={step.number} className="group card overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold marker:content-none hover:bg-accent-soft/20 [&::-webkit-details-marker]:hidden">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-primary">
                  {step.number}
                </span>
                <span className="flex-1 text-sm leading-snug">{step.title}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <p className="border-t border-border px-4 py-3 text-sm leading-relaxed text-muted">
                {step.description}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
