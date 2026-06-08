"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CaseStudy } from "@/lib/types";
import { loadContent, saveContent } from "./api";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";

function newCase(): CaseStudy {
  return {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    metric: "",
    metricLabel: "",
    secondMetric: "",
    secondMetricLabel: "",
    serviceSlug: "",
  };
}

export function CasesEditor() {
  const [items, setItems] = useState<CaseStudy[]>([]);
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<CaseStudy[]>("cases.json").then(setItems);
  }, []);

  function update(index: number, patch: Partial<CaseStudy>) {
    setItems(items.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function remove(index: number) {
    if (!confirm("Удалить этот кейс?")) return;
    setItems(items.filter((_, i) => i !== index));
  }

  function add() {
    setItems([...items, newCase()]);
  }

  async function save() {
    await run(() => saveContent("cases.json", items));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Кейсы с цифрами на главной странице. Две метрики — например «5 дней» и «2 документа».
      </p>

      {items.map((item, index) => (
        <AdminCard key={item.id}>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-primary">
              Кейс {index + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(index)}
              className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4">
            <Field label="Заголовок">
              <TextInput
                value={item.title}
                onChange={(e) => update(index, { title: e.target.value })}
              />
            </Field>
            <Field label="Описание">
              <TextArea
                value={item.description}
                onChange={(e) => update(index, { description: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Первая цифра">
                <TextInput
                  value={item.metric}
                  onChange={(e) => update(index, { metric: e.target.value })}
                  placeholder="5 дней"
                />
              </Field>
              <Field label="Подпись к первой цифре">
                <TextInput
                  value={item.metricLabel}
                  onChange={(e) => update(index, { metricLabel: e.target.value })}
                  placeholder="Срок оформления"
                />
              </Field>
              <Field label="Вторая цифра">
                <TextInput
                  value={item.secondMetric}
                  onChange={(e) => update(index, { secondMetric: e.target.value })}
                  placeholder="2 документа"
                />
              </Field>
              <Field label="Подпись ко второй цифре">
                <TextInput
                  value={item.secondMetricLabel}
                  onChange={(e) =>
                    update(index, { secondMetricLabel: e.target.value })
                  }
                  placeholder="В одном пакете"
                />
              </Field>
            </div>
            <Field
              label="Ссылка на услугу (необязательно)"
              hint="Адрес страницы без /uslugi/, например deklaratsiya-sootvetstviya-eaes"
            >
              <TextInput
                value={item.serviceSlug || ""}
                onChange={(e) => update(index, { serviceSlug: e.target.value })}
              />
            </Field>
          </div>
        </AdminCard>
      ))}

      <button
        type="button"
        onClick={add}
        className="btn-outline flex w-full items-center justify-center gap-2 py-3 text-sm"
      >
        <Plus className="h-4 w-4" />
        Добавить кейс
      </button>

      <SaveButton onClick={save} status={status} />
    </div>
  );
}
