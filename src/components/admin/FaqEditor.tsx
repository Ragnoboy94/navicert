"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FaqItem } from "@/lib/types";
import { loadContent, saveContent } from "./api";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";

export function FaqEditor() {
  const [items, setItems] = useState<FaqItem[]>([]);
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<FaqItem[]>("faq.json").then(setItems);
  }, []);

  function update(index: number, patch: Partial<FaqItem>) {
    setItems(items.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function remove(index: number) {
    if (!confirm("Удалить этот вопрос?")) return;
    setItems(items.filter((_, i) => i !== index));
  }

  function add() {
    setItems([...items, { question: "", answer: "" }]);
  }

  async function save() {
    await run(() => saveContent("faq.json", items));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Блок «Частые вопросы» на главной. Вопрос — заголовок, ответ раскрывается по нажатию.
      </p>

      {items.map((item, index) => (
        <AdminCard key={index}>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-primary">
              Вопрос {index + 1}
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
            <Field label="Вопрос">
              <TextInput
                value={item.question}
                onChange={(e) => update(index, { question: e.target.value })}
              />
            </Field>
            <Field label="Ответ">
              <TextArea
                value={item.answer}
                onChange={(e) => update(index, { answer: e.target.value })}
                className="min-h-[120px]"
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
        Добавить вопрос
      </button>

      <SaveButton onClick={save} status={status} />
    </div>
  );
}
