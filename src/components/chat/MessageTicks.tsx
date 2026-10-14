import { Check, CheckCheck } from "lucide-react";

type Props = {
  read: boolean;
  /** На тёмном пузырьке (свой ответ). */
  onDark?: boolean;
};

export function MessageTicks({ read, onDark = false }: Props) {
  const cls = onDark
    ? read
      ? "text-sky-200"
      : "text-white/65"
    : read
      ? "text-sky-500"
      : "text-slate-400";

  if (read) {
    return (
      <CheckCheck
        className={`inline-block h-3.5 w-3.5 shrink-0 ${cls}`}
        strokeWidth={2.5}
        aria-label="Прочитано"
      />
    );
  }

  return (
    <Check
      className={`inline-block h-3.5 w-3.5 shrink-0 ${cls}`}
      strokeWidth={2.5}
      aria-label="Отправлено"
    />
  );
}
