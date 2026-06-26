"use client";

import { Search, X } from "lucide-react";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  placeholder: string;
  total: number;
  totalLabel: string;
  resultsCount: number;
  isSearching: boolean;
  isPending: boolean;
  isActive: boolean;
};

export function ContentSearchField({
  id,
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  total,
  totalLabel,
  resultsCount,
  isSearching,
  isPending,
  isActive,
}: Props) {
  return (
    <div className="mx-auto mt-8 max-w-xl">
      <label
        htmlFor={id}
        className={`group relative block transition-opacity ${isPending ? "opacity-90" : ""}`}
      >
        <span
          className={`pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-r from-accent/30 via-primary-light/25 to-accent/30 transition-opacity duration-300 ${
            isActive ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden
        />
        <span className="relative flex items-center gap-2.5 rounded-2xl border border-border bg-card px-2.5 py-2 shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-200 group-focus-within:border-accent/40 group-focus-within:shadow-[0_6px_24px_-8px_rgba(10,31,77,0.1),0_0_0_3px_rgba(0,184,240,0.1)] sm:px-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary transition-colors group-focus-within:bg-[linear-gradient(135deg,var(--accent)_0%,var(--primary-light)_100%)] group-focus-within:text-white">
            <Search className="h-4 w-4" aria-hidden />
          </span>
          <input
            id={id}
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={placeholder}
            className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-sm text-foreground outline-none placeholder:text-muted/70"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-background hover:text-foreground"
              aria-label="Очистить поиск"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="hidden shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[0.625rem] font-medium text-muted sm:inline">
              {total} {totalLabel}
            </span>
          )}
        </span>
      </label>

      {isSearching && (
        <p
          className="mt-2 flex items-center justify-center gap-2 text-xs text-muted"
          aria-live="polite"
        >
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] font-semibold ${
              resultsCount > 0
                ? "bg-accent-soft text-primary"
                : "bg-background text-muted"
            }`}
          >
            {resultsCount}
          </span>
          <span className={isPending ? "opacity-70" : ""}>
            {resultsCount > 0
              ? `из ${total} ${totalLabel}`
              : "ничего не найдено — попробуйте другие слова"}
          </span>
        </p>
      )}
    </div>
  );
}
