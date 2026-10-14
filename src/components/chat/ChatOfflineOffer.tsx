"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/PhoneInput";
import { resolveQuizOutcome } from "@/lib/quiz-resolve";
import {
  isValidRuPhone,
  normalizeRuPhone,
  validateLeadName,
} from "@/lib/phone";
import type { QuizConfig, QuizOutcome } from "@/lib/types";

export type OfflineOfferPhase =
  | "prompt"
  | "waiting"
  | "quiz"
  | "form"
  | "done";

type ChatOfflineOfferProps = {
  visitorId: string;
  phase: OfflineOfferPhase;
  waitingReplyText: string;
  /** Заявка уже оформлена — кнопку «Оформить» не показываем. */
  hasLead?: boolean;
  onWait: () => void;
  onStartQuiz: () => void;
  onQuizFinished: (outcome: QuizOutcome) => void;
  onDone: () => void;
  outcome: QuizOutcome | null;
};

export function ChatOfflineOffer({
  visitorId,
  phase,
  waitingReplyText,
  hasLead = false,
  onWait,
  onStartQuiz,
  onQuizFinished,
  onDone,
  outcome,
}: ChatOfflineOfferProps) {
  const [quiz, setQuiz] = useState<QuizConfig | null>(null);
  const [quizError, setQuizError] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [formOpenedAt, setFormOpenedAt] = useState(() => Date.now());
  const [phoneKey, setPhoneKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (phase !== "quiz" && phase !== "form") return;
    if (quiz || quizError) return;
    let cancelled = false;
    void fetch("/api/quiz")
      .then((res) => {
        if (!res.ok) throw new Error("quiz");
        return res.json() as Promise<{ quiz?: QuizConfig }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!data.quiz?.steps?.length) throw new Error("quiz");
        setQuiz(data.quiz);
      })
      .catch(() => {
        if (!cancelled) setQuizError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, quiz, quizError]);

  useEffect(() => {
    if (phase !== "quiz") return;
    setStep(0);
    setAnswers({});
    setQuizError(false);
  }, [phase]);

  useEffect(() => {
    if (phase === "form") setFormOpenedAt(Date.now());
  }, [phase]);

  const current = quiz?.steps[step];

  const messagePreview = useMemo(() => {
    if (!outcome) return "";
    return [outcome.result.title, outcome.result.description]
      .filter(Boolean)
      .join("\n");
  }, [outcome]);

  function selectOption(value: string) {
    if (!quiz || !current) return;
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    if (step < quiz.steps.length - 1) {
      setStep(step + 1);
      return;
    }
    onQuizFinished(resolveQuizOutcome(quiz, next));
  }

  async function submitLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setFormError("");
    setNameError("");

    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const phoneRaw = String(data.get("phone") || "");
    const consent = data.get("consent");

    if (consent !== "on") {
      setFormError("Примите политику конфиденциальности");
      setSubmitting(false);
      return;
    }
    if (!validateLeadName(name)) {
      setNameError("Укажите имя (минимум 2 буквы)");
      setSubmitting(false);
      return;
    }
    const phone = normalizeRuPhone(phoneRaw);
    if (!phone || !isValidRuPhone(phoneRaw)) {
      setFormError("Укажите корректный номер телефона");
      setSubmitting(false);
      return;
    }

    const pathLine = outcome?.path ? `\n\nПуть: ${outcome.path}` : "";
    const messageValue = `${messagePreview}${pathLine}`.trim();

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          message: messageValue || undefined,
          service: outcome?.result.title || undefined,
          source: "chat",
          consent: true,
          clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          company: "",
          formOpenedAt,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Ошибка отправки");
      }
      const created = (await res.json()) as { id?: string };
      const leadId = created.id?.trim() || "";
      if (visitorId && leadId) {
        await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "attach_lead",
            visitorId,
            name,
            phone,
            leadId,
            summaryText: messageValue,
          }),
        }).catch(() => undefined);
      }
      setPhoneKey((k) => k + 1);
      onDone();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Ошибка отправки");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "waiting") {
    return (
      <div className="rounded-2xl border border-border bg-white px-3.5 py-3 text-sm text-muted shadow-sm">
        {waitingReplyText}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 shadow-sm">
        Заявка отправлена. Мы свяжемся с вами в ближайшее время.
      </div>
    );
  }

  if (phase === "prompt") {
    return (
      <div className="rounded-2xl border border-border bg-white px-3.5 py-3 text-sm shadow-sm">
        <p className="font-medium text-foreground">Если админ не в чате</p>
        <p className="mt-1 text-muted">
          {hasLead
            ? "Можете подождать ответа в этом чате."
            : "Можете подождать или оформить заявку прямо здесь."}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={onWait}
            className="rounded-xl border border-border px-3 py-2.5 text-left text-sm font-medium text-foreground transition hover:bg-slate-50"
          >
            Дождаться ответа
          </button>
          {!hasLead && (
            <button
              type="button"
              onClick={onStartQuiz}
              className="rounded-xl bg-accent px-3 py-2.5 text-left text-sm font-medium text-white transition hover:opacity-95"
            >
              Оформить заявку тут
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "quiz") {
    if (quizError) {
      return (
        <div className="rounded-2xl border border-border bg-white px-3.5 py-3 text-sm text-muted shadow-sm">
          Не удалось загрузить варианты.{" "}
          <Link href="/kalkulyator" className="text-accent underline">
            Открыть калькулятор
          </Link>
        </div>
      );
    }
    if (!quiz || !current) {
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-white px-3.5 py-3 text-sm text-muted shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-border bg-white px-3.5 py-3 text-sm shadow-sm">
        <p className="font-medium text-foreground">{current.question}</p>
        <div className="mt-3 flex flex-col gap-2">
          {current.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => selectOption(opt.value)}
              className="rounded-xl border border-border px-3 py-2.5 text-left text-sm font-medium text-foreground transition hover:border-accent hover:bg-accent-soft/40"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-white px-3.5 py-3 text-sm shadow-sm">
      {outcome && (
        <div className="mb-3 rounded-xl bg-[#f4f7fb] px-3 py-2">
          <p className="font-semibold text-primary-dark">
            {outcome.result.title}
          </p>
          {outcome.result.description && (
            <p className="mt-1 text-xs text-muted">
              {outcome.result.description}
            </p>
          )}
        </div>
      )}
      <p className="mb-2 font-medium text-foreground">Оставьте контакты</p>
      <form onSubmit={(e) => void submitLead(e)} className="space-y-2">
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          className="hidden"
          aria-hidden
        />
        <div>
          <input
            name="name"
            type="text"
            required
            placeholder="Имя"
            className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {nameError && (
            <p className="mt-1 text-xs text-red-600">{nameError}</p>
          )}
        </div>
        <PhoneInput
          key={phoneKey}
          className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <label className="flex items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            name="consent"
            value="on"
            required
            className="mt-0.5"
          />
          <span>
            Согласен с{" "}
            <Link href="/privacy" className="text-accent underline">
              политикой конфиденциальности
            </Link>
          </span>
        </label>
        {formError && <p className="text-xs text-red-600">{formError}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Отправить заявку"
          )}
        </button>
      </form>
    </div>
  );
}
