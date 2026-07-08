"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";

type PreviewState = {
  emailMasked: string;
  categoryLabel: string;
  companyName: string | null;
};

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Ссылка для отписки недействительна");
      setLoading(false);
      return;
    }

    fetch(`/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Ссылка недействительна");
        setPreview({
          emailMasked: json.emailMasked,
          categoryLabel: json.categoryLabel,
          companyName: json.companyName,
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function confirm() {
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/outreach/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(json.error || "Не удалось выполнить отписку");
      return;
    }
    setDone(true);
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-primary-dark">
          Отписка от рассылки
        </h1>

        {loading && <p className="mt-4 text-muted">Загрузка…</p>}

        {error && !done && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}

        {done && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-green-700">
              Вы отписаны от рассылки:{" "}
              <strong>{preview?.categoryLabel}</strong>.
            </p>
            <p className="text-muted">
              Другие виды информационных уведомлений (если появятся) на этот
              адрес по-прежнему могут приходить.
            </p>
          </div>
        )}

        {!loading && !done && preview && !error && (
          <div className="mt-4 space-y-4 text-sm">
            <p>
              Отписать адрес <strong>{preview.emailMasked}</strong>
              {preview.companyName ? (
                <>
                  {" "}
                  (компания <strong>{preview.companyName}</strong>)
                </>
              ) : null}{" "}
              от рассылки: <strong>{preview.categoryLabel}</strong>?
            </p>
            <p className="text-muted">
              Отписка действует только для этой категории писем. Мы сохраним
              ваш адрес в списке отказавшихся и больше не будем отправлять
              такие уведомления.
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={submitting}
              className="btn-primary w-full py-2.5 text-sm"
            >
              {submitting ? "Обработка…" : "Подтвердить отписку"}
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-muted">
          <Link href="/" className="underline hover:text-primary">
            На главную
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function UnsubscribeClient() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-lg px-4 py-16 text-muted">Загрузка…</main>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  );
}
