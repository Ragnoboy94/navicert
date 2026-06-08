"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, HelpCircle, RotateCcw } from "lucide-react";
import type { QuizConfig } from "@/lib/types";

function resolveResult(
  config: QuizConfig,
  answers: Record<string, string>
): QuizConfig["results"][string] {
  const category = answers.category || "other";
  const goal = answers.goal || "unknown";
  if (goal === "unknown") return config.results.default;
  const key = `${category}-${goal}`;
  return config.results[key] || config.results.default;
}

export function QuizTeaser({ config }: { config: QuizConfig }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const current = config.steps[step];
  const result = done ? resolveResult(config, answers) : null;

  function select(value: string) {
    if (!current) return;
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    if (step < config.steps.length - 1) {
      setStep(step + 1);
    } else {
      setDone(true);
    }
  }

  function reset() {
    setStep(0);
    setAnswers({});
    setDone(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-4 text-left backdrop-blur transition hover:bg-white/15"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/20">
          <HelpCircle className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Не знаете, какой документ нужен?</p>
          <p className="text-xs text-blue-200">2 вопроса — подскажем вариант</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-blue-200" />
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{config.title}</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-xs text-blue-200 hover:text-white"
        >
          Свернуть
        </button>
      </div>

      {!done && current && (
        <>
          <p className="text-xs text-blue-200">
            Шаг {step + 1} из {config.steps.length}
          </p>
          <p className="mt-1 text-sm font-medium">{current.question}</p>
          <div className="mt-3 grid gap-2">
            {current.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => select(opt.value)}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-left text-xs transition hover:bg-white/20 sm:text-sm"
              >
                {opt.label}
              </button>
            ))}
          </div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="mt-2 text-xs text-blue-200 hover:text-white"
            >
              ← Назад
            </button>
          )}
        </>
      )}

      {done && result && (
        <div>
          <p className="font-semibold">{result.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-blue-100">
            {result.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/#zayavka" className="btn-primary px-3 py-2 text-xs">
              Консультация
            </Link>
            {result.serviceSlug && (
              <Link
                href={`/uslugi/${result.serviceSlug}`}
                className="rounded-full border border-white/30 px-3 py-2 text-xs font-medium"
              >
                Об услуге
              </Link>
            )}
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 px-2 py-2 text-xs text-blue-200"
            >
              <RotateCcw className="h-3 w-3" />
              Заново
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
