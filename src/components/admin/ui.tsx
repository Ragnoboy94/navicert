"use client";

import { forwardRef, useState } from "react";
import { Loader2, Check, AlertCircle } from "lucide-react";

export function AdminCard({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-white shadow-sm ${className}`}>
      {(title || description) && (
        <div className="border-b border-border px-5 py-4 sm:px-6">
          {title && <h2 className="text-lg font-bold text-primary-dark">{title}</h2>}
          {description && (
            <p className="mt-1 text-sm text-muted">{description}</p>
          )}
        </div>
      )}
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`input-field ${props.className || ""}`}
    />
  );
}

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea(props, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={`input-field min-h-[100px] resize-y ${props.className || ""}`}
    />
  );
});

export function SaveButton({
  onClick,
  status,
  label = "Сохранить изменения",
}: {
  onClick: () => void;
  status: "idle" | "saving" | "saved" | "error";
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={status === "saving"}
        className="btn-primary px-5 py-2.5 text-sm"
      >
        {status === "saving" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : null}
        {status === "saved" ? "Сохранено" : label}
      </button>
      {status === "saved" && (
        <span className="inline-flex items-center gap-1 text-sm text-green-600">
          <Check className="h-4 w-4" />
          Изменения применены
        </span>
      )}
      {status === "error" && (
        <span className="inline-flex items-center gap-1 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          Не удалось сохранить
        </span>
      )}
    </div>
  );
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>("idle");
  async function run(fn: () => Promise<void>) {
    setStatus("saving");
    try {
      await fn();
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }
  return { status, run };
}
