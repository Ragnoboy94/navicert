"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { QuizConfig, QuizOption, QuizResult, QuizStep, Service } from "@/lib/types";
import { loadContent, saveContent } from "./api";
import { ArticleRichEditor } from "./ArticleRichEditor";
import {
  AdminCard,
  Field,
  TextInput,
  TextArea,
  SaveButton,
  useSaveStatus,
} from "./ui";

type MatchRow = {
  id: string;
  answers: Record<string, string>;
  title: string;
  description: string;
  serviceSlug: string;
};

const KEY_SEP = "|";

const DEFAULT_HOW_IT_WORKS = {
  title: "Как это работает",
  body: "<ol><li><p>Выберите тип продукции и задачу</p></li><li><p>Получите рекомендуемый документ</p></li><li><p>Оставьте контакты — перезвоним с расчётом</p></li></ol>",
};

/** Старый формат howItWorks.steps → HTML для редактора. */
function normalizeHowItWorks(
  raw: QuizConfig["howItWorks"] | undefined
): { title: string; body: string } {
  if (!raw) {
    return { ...DEFAULT_HOW_IT_WORKS };
  }
  const title = raw.title?.trim() || DEFAULT_HOW_IT_WORKS.title;
  const body = (raw as { body?: string }).body?.trim() || "";
  if (body) return { title, body };
  const legacySteps = (raw as { steps?: string[] }).steps;
  if (Array.isArray(legacySteps) && legacySteps.some((s) => s?.trim())) {
    const items = legacySteps
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `<li><p>${s}</p></li>`)
      .join("");
    return { title, body: `<ol>${items}</ol>` };
  }
  return { title, body: DEFAULT_HOW_IT_WORKS.body };
}

function emptyConfig(): QuizConfig {
  return {
    title: "Какой документ вам нужен?",
    subtitle: "Ответьте на вопросы — подскажем оптимальный вариант",
    howItWorks: { ...DEFAULT_HOW_IT_WORKS },
    steps: [
      {
        id: "category",
        question: "Какая у вас продукция?",
        options: [{ value: "other", label: "Другое" }],
      },
      {
        id: "goal",
        question: "Какая у вас задача?",
        options: [
          { value: "mandatory", label: "Обязательная сертификация" },
          { value: "unknown", label: "Не знаю — нужна консультация" },
        ],
      },
    ],
    results: {
      default: {
        title: "Бесплатная консультация эксперта",
        description:
          "По вашему описанию продукции определим точный перечень документов.",
        serviceSlug: "",
      },
    },
  };
}

function makeStepId(existing: QuizStep[]): string {
  let n = existing.length + 1;
  let id = `question-${n}`;
  while (existing.some((s) => s.id === id)) {
    n += 1;
    id = `question-${n}`;
  }
  return id;
}

function makeOptionValue(existing: QuizOption[]): string {
  let n = existing.length + 1;
  let value = `opt${n}`;
  while (existing.some((o) => o.value === value)) {
    n += 1;
    value = `opt${n}`;
  }
  return value;
}

function matchKey(answers: Record<string, string>, steps: QuizStep[]): string {
  return steps.map((s) => answers[s.id] || "").join(KEY_SEP);
}

/** Старые ключи были `category-goal` через дефис — переводим в `a|b`. */
function parseLegacyKey(
  key: string,
  steps: QuizStep[]
): Record<string, string> | null {
  if (steps.length === 2 && !key.includes(KEY_SEP)) {
    const [a, ...rest] = key.split("-");
    const b = rest.join("-");
    if (a && b) {
      return { [steps[0].id]: a, [steps[1].id]: b };
    }
  }
  if (key.includes(KEY_SEP)) {
    const parts = key.split(KEY_SEP);
    if (parts.length === steps.length && parts.every(Boolean)) {
      const answers: Record<string, string> = {};
      steps.forEach((s, i) => {
        answers[s.id] = parts[i];
      });
      return answers;
    }
  }
  return null;
}

function resultsToRows(
  results: Record<string, QuizResult>,
  steps: QuizStep[]
): MatchRow[] {
  return Object.entries(results)
    .filter(([key]) => key !== "default")
    .map(([key, value], index) => {
      const answers =
        parseLegacyKey(key, steps) ||
        Object.fromEntries(steps.map((s) => [s.id, ""]));
      return {
        id: `row-${index}-${key}`,
        answers,
        title: value.title || "",
        description: value.description || "",
        serviceSlug: value.serviceSlug || "",
      };
    });
}

function rowsToResults(
  rows: MatchRow[],
  fallback: QuizResult,
  steps: QuizStep[]
): Record<string, QuizResult> {
  const results: Record<string, QuizResult> = {
    default: {
      title: fallback.title,
      description: fallback.description,
      serviceSlug: fallback.serviceSlug || "",
    },
  };
  for (const row of rows) {
    if (!steps.every((s) => row.answers[s.id])) continue;
    const key = matchKey(row.answers, steps);
    results[key] = {
      title: row.title,
      description: row.description,
      serviceSlug: row.serviceSlug || "",
    };
  }
  return results;
}

function optionLabel(step: QuizStep | undefined, value: string) {
  if (!step) return value;
  return step.options.find((o) => o.value === value)?.label || value;
}

function ServiceSelect({
  value,
  onChange,
  services,
}: {
  value: string;
  onChange: (v: string) => void;
  services: Service[];
}) {
  return (
    <select
      className="input-field"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Без ссылки на услугу</option>
      {services.map((s) => (
        <option key={s.slug} value={s.slug}>
          {s.shortTitle || s.title}
        </option>
      ))}
    </select>
  );
}

export function QuizEditor() {
  const [config, setConfig] = useState<QuizConfig | null>(null);
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [fallback, setFallback] = useState<QuizResult>({
    title: "",
    description: "",
    serviceSlug: "",
  });
  const [services, setServices] = useState<Service[]>([]);
  const [openStep, setOpenStep] = useState<number>(0);
  const { status, run } = useSaveStatus();

  useEffect(() => {
    Promise.all([
      loadContent<QuizConfig>("quiz.json"),
      loadContent<Service[]>("services.json"),
    ]).then(([quiz, serviceList]) => {
      const next = quiz?.steps?.length ? quiz : emptyConfig();
      setConfig({
        ...next,
        howItWorks: normalizeHowItWorks(next.howItWorks),
      });
      setRows(resultsToRows(next.results || {}, next.steps));
      setFallback(
        next.results?.default || {
          title: "",
          description: "",
          serviceSlug: "",
        }
      );
      setServices(serviceList || []);
    });
  }, []);

  const steps = config?.steps || [];

  const missingCombos = useMemo(() => {
    if (steps.length < 2) return 0;
    // Для подсказки: сколько пар из первых двух вопросов ещё без ответа
    const a = steps[0]?.options || [];
    const b = (steps[1]?.options || []).filter((o) => o.value !== "unknown");
    if (!a.length || !b.length) return 0;
    const have = new Set(
      rows.map((r) => `${r.answers[steps[0].id]}|${r.answers[steps[1].id]}`)
    );
    let missing = 0;
    for (const oa of a) {
      for (const ob of b) {
        if (!have.has(`${oa.value}|${ob.value}`)) missing += 1;
      }
    }
    return missing;
  }, [rows, steps]);

  function setSteps(next: QuizStep[]) {
    if (!config) return;
    setConfig({ ...config, steps: next });
  }

  function updateStep(index: number, patch: Partial<QuizStep>) {
    setSteps(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const id = makeStepId(steps);
    const next: QuizStep = {
      id,
      question: "",
      options: [
        { value: makeOptionValue([]), label: "" },
        { value: makeOptionValue([{ value: "opt1", label: "" }]), label: "" },
      ],
    };
    setSteps([...steps, next]);
    setOpenStep(steps.length);
    // Новые ответы для N+1 шага нужно заполнять заново — очищаем неполные
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        answers: { ...row.answers, [id]: "" },
      }))
    );
  }

  function removeStep(index: number) {
    if (steps.length <= 1) {
      alert("Нужен хотя бы один вопрос");
      return;
    }
    const removed = steps[index];
    if (
      !confirm(
        `Удалить вопрос «${removed.question || `№${index + 1}`}»? Связанные ответы тоже нужно будет проверить.`
      )
    ) {
      return;
    }
    const next = steps.filter((_, i) => i !== index);
    setSteps(next);
    setRows((prev) =>
      prev.map((row) => {
        const answers = { ...row.answers };
        delete answers[removed.id];
        return { ...row, answers };
      })
    );
    setOpenStep((cur) => Math.min(cur, next.length - 1));
  }

  function moveStep(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    [next[index], next[to]] = [next[to], next[index]];
    setSteps(next);
    setOpenStep(to);
  }

  function updateOption(stepIndex: number, optIndex: number, label: string) {
    const step = steps[stepIndex];
    const options = step.options.map((o, i) =>
      i === optIndex ? { ...o, label } : o
    );
    updateStep(stepIndex, { options });
  }

  function addOption(stepIndex: number) {
    const step = steps[stepIndex];
    updateStep(stepIndex, {
      options: [
        ...step.options,
        { value: makeOptionValue(step.options), label: "" },
      ],
    });
  }

  function removeOption(stepIndex: number, optIndex: number) {
    const step = steps[stepIndex];
    if (step.options.length <= 1) {
      alert("У вопроса должен быть хотя бы один вариант");
      return;
    }
    const removed = step.options[optIndex];
    if (!confirm(`Удалить вариант «${removed.label || "без названия"}»?`)) {
      return;
    }
    updateStep(stepIndex, {
      options: step.options.filter((_, i) => i !== optIndex),
    });
    setRows((prev) =>
      prev.filter((row) => row.answers[step.id] !== removed.value)
    );
  }

  function addMatchRow() {
    const answers: Record<string, string> = {};
    for (const step of steps) {
      const first =
        step.options.find((o) => o.value !== "unknown") || step.options[0];
      answers[step.id] = first?.value || "";
    }
    setRows((prev) => [
      ...prev,
      {
        id: `row-new-${Date.now()}`,
        answers,
        title: "",
        description: "",
        serviceSlug: "",
      },
    ]);
    // scroll to new row after paint
    requestAnimationFrame(() => {
      document
        .getElementById("quiz-matches")
        ?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }

  function addMissingPairs() {
    if (steps.length < 2) return;
    const a = steps[0];
    const b = steps[1];
    const have = new Set(
      rows.map((r) => `${r.answers[a.id]}|${r.answers[b.id]}`)
    );
    const extras: MatchRow[] = [];
    for (const oa of a.options) {
      for (const ob of b.options) {
        if (ob.value === "unknown") continue;
        const k = `${oa.value}|${ob.value}`;
        if (have.has(k)) continue;
        const answers: Record<string, string> = {
          [a.id]: oa.value,
          [b.id]: ob.value,
        };
        for (let i = 2; i < steps.length; i++) {
          answers[steps[i].id] = steps[i].options[0]?.value || "";
        }
        extras.push({
          id: `row-fill-${oa.value}-${ob.value}-${Date.now()}`,
          answers,
          title: "",
          description: "",
          serviceSlug: "",
        });
      }
    }
    if (!extras.length) {
      alert("Все пары уже добавлены");
      return;
    }
    setRows((prev) => [...prev, ...extras]);
  }

  function updateRow(id: string, patch: Partial<MatchRow>) {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function updateRowAnswer(id: string, stepId: string, value: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? { ...row, answers: { ...row.answers, [stepId]: value } }
          : row
      )
    );
  }

  function removeRow(id: string) {
    if (!confirm("Удалить эту пару ответов?")) return;
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  async function save() {
    if (!config) return;
    const emptyQuestions = steps.filter((s) => !s.question.trim());
    if (emptyQuestions.length) {
      alert("Заполните текст у всех вопросов");
      return;
    }
    const how = normalizeHowItWorks(config.howItWorks);
    const payload: QuizConfig = {
      title: config.title,
      subtitle: config.subtitle,
      howItWorks: {
        title: how.title,
        body: how.body,
      },
      steps,
      results: rowsToResults(rows, fallback, steps),
    };
    await run(() => saveContent("quiz.json", payload));
  }

  if (!config) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <p className="text-sm text-muted">
        Квиз на главной и на{" "}
        <a
          href="/kalkulyator"
          className="font-medium text-accent hover:underline"
        >
          /kalkulyator
        </a>
        . Добавляйте вопросы и варианты — внизу задайте, что показать за каждую
        комбинацию ответов.
      </p>

      {/* 1. Шапка */}
      <AdminCard title="Шапка квиза">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Заголовок">
            <TextInput
              value={config.title}
              onChange={(e) => setConfig({ ...config, title: e.target.value })}
              placeholder="Какой документ вам нужен?"
            />
          </Field>
          <Field label="Подзаголовок">
            <TextInput
              value={config.subtitle}
              onChange={(e) =>
                setConfig({ ...config, subtitle: e.target.value })
              }
              placeholder="Ответьте на вопросы — подскажем вариант"
            />
          </Field>
        </div>
      </AdminCard>

      <AdminCard
        title="Блок «Как это работает»"
        description="Карточка справа на /kalkulyator — тот же редактор, что у статей."
      >
        <div className="space-y-3">
          <Field label="Заголовок блока">
            <TextInput
              value={config.howItWorks?.title || ""}
              onChange={(e) =>
                setConfig((prev) =>
                  prev
                    ? {
                        ...prev,
                        howItWorks: {
                          title: e.target.value,
                          body: prev.howItWorks?.body || "",
                        },
                      }
                    : prev
                )
              }
              placeholder="Как это работает"
            />
          </Field>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Текст
            </span>
            <ArticleRichEditor
              key="quiz-how-it-works"
              value={config.howItWorks?.body || ""}
              onChange={(body) =>
                setConfig((prev) =>
                  prev
                    ? {
                        ...prev,
                        howItWorks: {
                          title:
                            prev.howItWorks?.title || DEFAULT_HOW_IT_WORKS.title,
                          body,
                        },
                      }
                    : prev
                )
              }
              slug="kalkulyator-how-it-works"
            />
          </div>
        </div>
      </AdminCard>

      {/* 2. Вопросы */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-primary-dark">Вопросы</h2>
            <p className="text-sm text-muted">
              Посетитель отвечает по очереди. Сейчас вопросов: {steps.length}
            </p>
          </div>
          <button
            type="button"
            onClick={addStep}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            Добавить вопрос
          </button>
        </div>

        {steps.map((step, stepIndex) => {
          const open = openStep === stepIndex;
          return (
            <div
              key={step.id}
              className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm"
            >
              <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
                <button
                  type="button"
                  onClick={() => setOpenStep(open ? -1 : stepIndex)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-background"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-primary">
                    {stepIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-primary-dark">
                      {step.question || `Вопрос ${stepIndex + 1} (без текста)`}
                    </p>
                    <p className="text-xs text-muted">
                      Вариантов: {step.options.length}
                    </p>
                  </div>
                  {open ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                  )}
                </button>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => moveStep(stepIndex, -1)}
                    disabled={stepIndex === 0}
                    className="rounded-lg p-1.5 text-muted hover:bg-background disabled:opacity-30"
                    title="Выше"
                    aria-label="Переместить выше"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(stepIndex, 1)}
                    disabled={stepIndex === steps.length - 1}
                    className="rounded-lg p-1.5 text-muted hover:bg-background disabled:opacity-30"
                    title="Ниже"
                    aria-label="Переместить ниже"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {open && (
                <div className="space-y-4 border-t border-border px-4 py-4 sm:px-5">
                  <Field label="Текст вопроса">
                    <TextInput
                      value={step.question}
                      onChange={(e) =>
                        updateStep(stepIndex, { question: e.target.value })
                      }
                      placeholder="Например: Какая у вас продукция?"
                      autoFocus
                    />
                  </Field>

                  <div>
                    <p className="mb-2 text-sm font-medium">Варианты ответа</p>
                    <div className="space-y-2">
                      {step.options.map((option, optIndex) => (
                        <div
                          key={option.value}
                          className="flex items-center gap-2"
                        >
                          <span className="w-6 shrink-0 text-center text-xs text-muted">
                            {optIndex + 1}
                          </span>
                          <input
                            className="input-field"
                            value={option.label}
                            onChange={(e) =>
                              updateOption(stepIndex, optIndex, e.target.value)
                            }
                            placeholder="Текст варианта"
                          />
                          <button
                            type="button"
                            onClick={() => removeOption(stepIndex, optIndex)}
                            className="shrink-0 rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"
                            aria-label="Удалить вариант"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => addOption(stepIndex)}
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                    >
                      <Plus className="h-4 w-4" />
                      Добавить вариант
                    </button>
                    {step.options.some((o) => o.value === "unknown") && (
                      <p className="mt-2 text-xs text-muted">
                        Вариант «Не знаю» всегда ведёт к ответу по умолчанию.
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() => removeStep(stepIndex)}
                      className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить вопрос
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 3. Ответы по комбинациям */}
      <div id="quiz-matches" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-primary-dark">
              Пары ответов
            </h2>
            <p className="text-sm text-muted">
              Если человек выбрал такие варианты — покажем этот текст. Сейчас
              пар: {rows.length}
              {missingCombos > 0
                ? ` · можно добавить ещё ${missingCombos}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {missingCombos > 0 && steps.length >= 2 && (
              <button
                type="button"
                onClick={addMissingPairs}
                className="btn-ghost px-4 py-2.5 text-sm"
              >
                Добавить недостающие
              </button>
            )}
            <button
              type="button"
              onClick={addMatchRow}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            >
              <Plus className="h-4 w-4" />
              Новая пара ответов
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <AdminCard>
            <p className="py-6 text-center text-sm text-muted">
              Пока нет ни одной пары. Нажмите «Новая пара ответов» или
              «Добавить недостающие».
            </p>
            <button
              type="button"
              onClick={addMatchRow}
              className="btn-primary mx-auto flex items-center gap-2 px-4 py-2.5 text-sm"
            >
              <Plus className="h-4 w-4" />
              Новая пара ответов
            </button>
          </AdminCard>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => {
              const summary = steps
                .map((s) => optionLabel(s, row.answers[s.id] || ""))
                .filter(Boolean)
                .join(" → ");
              return (
                <div
                  key={row.id}
                  className="rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary">
                        Пара {index + 1}
                      </p>
                      {summary && (
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {summary}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="shrink-0 rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"
                      aria-label="Удалить пару"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div
                    className={`mb-3 grid gap-3 ${
                      steps.length === 1
                        ? "sm:grid-cols-1"
                        : steps.length === 2
                          ? "sm:grid-cols-2"
                          : "sm:grid-cols-2 lg:grid-cols-3"
                    }`}
                  >
                    {steps.map((step, si) => (
                      <Field
                        key={step.id}
                        label={
                          step.question
                            ? `Если: ${step.question}`
                            : `Вопрос ${si + 1}`
                        }
                      >
                        <select
                          className="input-field"
                          value={row.answers[step.id] || ""}
                          onChange={(e) =>
                            updateRowAnswer(row.id, step.id, e.target.value)
                          }
                        >
                          <option value="">Выберите…</option>
                          {step.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label || o.value}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ))}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Заголовок ответа на сайте">
                      <TextInput
                        value={row.title}
                        onChange={(e) =>
                          updateRow(row.id, { title: e.target.value })
                        }
                        placeholder="Например: Декларация ЕАЭС"
                      />
                    </Field>
                    <Field label="Услуга (кнопка «Об услуге»)">
                      <ServiceSelect
                        value={row.serviceSlug}
                        onChange={(serviceSlug) =>
                          updateRow(row.id, { serviceSlug })
                        }
                        services={services}
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Пояснение">
                        <TextArea
                          value={row.description}
                          onChange={(e) =>
                            updateRow(row.id, { description: e.target.value })
                          }
                          className="min-h-[72px]"
                          placeholder="Коротко, какой документ нужен"
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={addMatchRow}
          className="btn-ghost flex w-full items-center justify-center gap-2 py-3 text-sm"
        >
          <Plus className="h-4 w-4" />
          Новая пара ответов
        </button>
      </div>

      {/* 4. Ответ по умолчанию — отдельный блок внизу */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-primary-dark">
            Ответ по умолчанию
          </h2>
          <p className="text-sm text-muted">
            Если точной пары нет или человек выбрал «не знаю»
          </p>
        </div>
        <AdminCard>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Заголовок">
              <TextInput
                value={fallback.title}
                onChange={(e) =>
                  setFallback({ ...fallback, title: e.target.value })
                }
                placeholder="Бесплатная консультация эксперта"
              />
            </Field>
            <Field label="Услуга">
              <ServiceSelect
                value={fallback.serviceSlug || ""}
                onChange={(serviceSlug) =>
                  setFallback({ ...fallback, serviceSlug })
                }
                services={services}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Пояснение">
                <TextArea
                  value={fallback.description}
                  onChange={(e) =>
                    setFallback({ ...fallback, description: e.target.value })
                  }
                  className="min-h-[80px]"
                />
              </Field>
            </div>
          </div>
        </AdminCard>
      </div>

      <div className="fixed bottom-0 right-0 z-20 border-t border-border bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:left-72 lg:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="hidden text-sm text-muted sm:block">
            После сохранения обновите страницу сайта (F5)
          </p>
          <SaveButton onClick={save} status={status} />
        </div>
      </div>
    </div>
  );
}
