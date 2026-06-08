"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import type { Review } from "@/lib/types";
import { loadContent, saveContent } from "./api";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";

function newReview(): Review {
  return {
    id: crypto.randomUUID(),
    category: "",
    text: "",
    author: "",
    location: "",
    role: "",
  };
}

export function ReviewsEditor() {
  const [items, setItems] = useState<Review[] | null>(null);
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<Review[]>("reviews.json").then(setItems);
  }, []);

  if (!items) {
    return <p className="text-muted">Загрузка…</p>;
  }

  function update(index: number, patch: Partial<Review>) {
    setItems(items!.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function remove(index: number) {
    if (!confirm("Удалить этот отзыв?")) return;
    setItems(items!.filter((_, i) => i !== index));
  }

  function add() {
    setItems([...items!, newReview()]);
  }

  async function save() {
    await run(() => saveContent("reviews.json", items!));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        На главной показываются до 3 отзывов в ряд на компьютере. Добавляйте новые или редактируйте существующие.
      </p>

      {items.map((review, index) => (
        <AdminCard key={review.id} className="relative">
          <div className="mb-4 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
              <GripVertical className="h-4 w-4 text-muted" />
              Отзыв {index + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(index)}
              className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"
              title="Удалить"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4">
            <Field label="Категория (подпись сверху)">
              <TextInput
                value={review.category}
                onChange={(e) => update(index, { category: e.target.value })}
                placeholder="Например: Декларация ЕАЭС"
              />
            </Field>
            <Field label="Текст отзыва">
              <TextArea
                value={review.text}
                onChange={(e) => update(index, { text: e.target.value })}
                className="min-h-[100px]"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Имя">
                <TextInput
                  value={review.author}
                  onChange={(e) => update(index, { author: e.target.value })}
                />
              </Field>
              <Field label="Город">
                <TextInput
                  value={review.location}
                  onChange={(e) => update(index, { location: e.target.value })}
                />
              </Field>
              <Field label="Должность / роль">
                <TextInput
                  value={review.role}
                  onChange={(e) => update(index, { role: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </AdminCard>
      ))}

      <button
        type="button"
        onClick={add}
        className="btn-outline flex w-full items-center justify-center gap-2 py-3 text-sm"
      >
        <Plus className="h-4 w-4" />
        Добавить отзыв
      </button>

      <SaveButton onClick={save} status={status} />
    </div>
  );
}
