"use client";

import { useState } from "react";
import Link from "next/link";
import { Send, Loader2, CheckCircle } from "lucide-react";

interface ContactFormProps {
  source?: string;
  service?: string;
  compact?: boolean;
  darkLabels?: boolean;
}

export function ContactForm({
  source = "website",
  service,
  compact = false,
  darkLabels = false,
}: ContactFormProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email") || undefined,
          message: data.get("message") || undefined,
          service: service || data.get("service") || undefined,
          source,
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Ошибка отправки");
      }

      setStatus("success");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Ошибка отправки");
    }
  }

  const labelClass = darkLabels
    ? "mb-1 block text-sm font-medium text-blue-100"
    : "mb-1 block text-sm font-medium text-foreground";

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-green-50 p-8 text-center">
        <CheckCircle className="h-12 w-12 text-green-600" />
        <p className="text-lg font-semibold text-green-800">Заявка отправлена!</p>
        <p className="text-sm text-green-700">
          Мы свяжемся с вами в ближайшее время.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-2 text-sm text-green-700 underline"
        >
          Отправить ещё одну
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className={compact ? "space-y-3" : "grid gap-4 sm:grid-cols-2"}>
        <div>
          <label htmlFor="name" className={labelClass}>
            Имя <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Ваше имя"
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>
            Телефон <span className="text-red-500">*</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            placeholder="+7 (___) ___-__-__"
            className="input-field"
          />
        </div>
      </div>

      {!compact && (
        <div>
          <label htmlFor="email" className={labelClass}>
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="email@example.com"
            className="input-field"
          />
        </div>
      )}

      {!compact && !service && (
        <div>
          <label htmlFor="message" className={labelClass}>
            Сообщение
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            placeholder="Опишите продукцию или задайте вопрос"
            className="input-field resize-none"
          />
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="consent"
          required
          className="mt-0.5 rounded"
        />
        <span>
          Я принимаю{" "}
          <Link href="/privacy" className="text-primary underline">
            политику конфиденциальности
          </Link>
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="btn-primary w-full px-6 py-3 text-sm disabled:opacity-60 sm:w-auto"
      >
        {status === "loading" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Отправка...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Отправить заявку
          </>
        )}
      </button>
    </form>
  );
}
