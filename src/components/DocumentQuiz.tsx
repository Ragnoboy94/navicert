"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { QuizConfig, QuizOutcome, QuizResult } from "@/lib/types";

function formatQuizPath(
  config: QuizConfig,
  answers: Record<string, string>
): string {
  return config.steps
    .map((s) => {
      const value = answers[s.id] || "";
      const label = s.options.find((o) => o.value === value)?.label || value;
      return label.trim();
    })
    .filter(Boolean)
    .join(" → ");
}

function resolveOutcome(
  config: QuizConfig,
  answers: Record<string, string>
): QuizOutcome {
  const path = formatQuizPath(config, answers);
  const values = config.steps.map((s) => answers[s.id] || "");
  const fallback: QuizResult = config.results.default;

  if (values.includes("unknown")) {
    return { result: fallback, path, matched: false };
  }

  const pipeKey = values.join("|");
  if (config.results[pipeKey]) {
    return { result: config.results[pipeKey], path, matched: true };
  }

  if (config.steps.length === 2) {
    const legacyKey = `${values[0]}-${values[1]}`;
    if (config.results[legacyKey]) {
      return { result: config.results[legacyKey], path, matched: true };
    }
  }

  return { result: fallback, path, matched: false };
}

function clearHash() {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (window.location.hash) {
    window.history.replaceState(null, "", `${pathname}${search}`);
  }
}

function scrollToHashTarget(href: string) {
  if (typeof window === "undefined") return;
  const id = href.startsWith("#") ? href.slice(1) : href.replace(/^.*#/, "");
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#${id}`
  );
}

type DocumentQuizProps = {
  config: QuizConfig;
  /** teaser — компактный блок на главной; page — полноценный калькулятор */
  variant?: "teaser" | "page";
  consultHref?: string;
  onResult?: (outcome: QuizOutcome | null) => void;
  onReset?: () => void;
};

export function DocumentQuiz({
  config,
  variant = "teaser",
  consultHref = "/#zayavka",
  onResult,
  onReset,
}: DocumentQuizProps) {
  const isPage = variant === "page";
  const [open, setOpen] = useState(isPage);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const current = config.steps[step];
  const outcome = done ? resolveOutcome(config, answers) : null;
  const result = outcome?.result ?? null;
  const progress = useMemo(() => {
    if (done) return 100;
    if (!config.steps.length) return 0;
    return Math.round((step / config.steps.length) * 100);
  }, [config.steps.length, done, step]);

  function select(value: string) {
    if (!current) return;
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    if (step < config.steps.length - 1) {
      setStep(step + 1);
    } else {
      setDone(true);
      onResult?.(resolveOutcome(config, next));
    }
  }

  function reset() {
    setStep(0);
    setAnswers({});
    setDone(false);
    clearHash();
    onResult?.(null);
    onReset?.();
  }

  function goToForm() {
    if (!consultHref.includes("#")) return;
    scrollToHashTarget(consultHref);
  }

  if (!open && !isPage) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-4 text-left backdrop-blur transition hover:bg-white/15"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/20">
          <span className="text-lg font-bold text-accent">?</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Не знаете, какой документ нужен?</p>
          <p className="text-xs text-blue-200">
            {config.steps.length}{" "}
            {config.steps.length === 1
              ? "вопрос"
              : config.steps.length < 5
                ? "вопроса"
                : "вопросов"}{" "}
            — подскажем вариант
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-blue-200" />
      </button>
    );
  }

  const shellClass = isPage
    ? "rounded-[1.5rem] border border-white/20 bg-white/10 p-6 backdrop-blur sm:p-8"
    : "rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur";

  const optionClass = isPage
    ? "rounded-2xl border border-white/15 bg-white/10 px-4 py-3.5 text-left text-sm font-medium transition hover:bg-white/20 sm:text-base"
    : "rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-left text-xs transition hover:bg-white/20 sm:text-sm";

  return (
    <div className={shellClass}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className={`font-semibold ${isPage ? "text-xl sm:text-2xl" : "text-sm"}`}>
            {config.title}
          </p>
          {config.subtitle && (
            <p className={`mt-1 text-blue-200 ${isPage ? "text-sm" : "text-xs"}`}>
              {config.subtitle}
            </p>
          )}
        </div>
        {!isPage && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              reset();
            }}
            className="shrink-0 text-xs text-blue-200 hover:text-white"
          >
            Свернуть
          </button>
        )}
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {!done && current && (
        <>
          <p className="text-xs text-blue-200 sm:text-sm">
            Шаг {step + 1} из {config.steps.length}
          </p>
          <p className={`mt-2 font-medium ${isPage ? "text-lg sm:text-xl" : "text-sm"}`}>
            {current.question}
          </p>
          <div className={`mt-4 grid gap-2 ${isPage ? "sm:gap-3" : ""}`}>
            {current.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => select(opt.value)}
                className={optionClass}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="mt-3 text-xs text-blue-200 hover:text-white sm:text-sm"
            >
              ← Назад
            </button>
          )}
        </>
      )}

      {done && result && (
        <div>
          <p className={`font-semibold ${isPage ? "text-xl sm:text-2xl" : ""}`}>
            {result.title}
          </p>
          <p
            className={`mt-2 leading-relaxed text-blue-100 ${
              isPage ? "text-sm sm:text-base" : "text-xs"
            }`}
          >
            {result.description}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {consultHref.includes("#") ? (
              <button
                type="button"
                onClick={goToForm}
                className={`btn-primary ${isPage ? "px-5 py-3 text-sm" : "px-3 py-2 text-xs"}`}
              >
                Оставить заявку
              </button>
            ) : (
              <Link
                href={consultHref}
                className={`btn-primary ${isPage ? "px-5 py-3 text-sm" : "px-3 py-2 text-xs"}`}
              >
                Оставить заявку
              </Link>
            )}
            {result.serviceSlug && (
              <Link
                href={`/uslugi/${result.serviceSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`rounded-full border border-white/30 font-medium ${
                  isPage ? "px-5 py-3 text-sm" : "px-3 py-2 text-xs"
                }`}
              >
                Об услуге
              </Link>
            )}
            <button
              type="button"
              onClick={reset}
              className={`inline-flex items-center gap-1 text-blue-200 ${
                isPage ? "px-3 py-3 text-sm" : "px-2 py-2 text-xs"
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Заново
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
