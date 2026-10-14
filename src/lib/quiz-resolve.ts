import type { QuizConfig, QuizOutcome, QuizResult } from "@/lib/types";

export function formatQuizPath(
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

export function resolveQuizOutcome(
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
