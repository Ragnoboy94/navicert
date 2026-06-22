"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, Trash2, Wand2 } from "lucide-react";
import type { Category } from "@/lib/types";
import { MarkdownContent } from "@/lib/markdown";
import { buildCategorySeo, uniqueSlug } from "@/lib/seo-content";
import { loadContent, saveContent } from "./api";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";

const FORMAT_HELP = `Пример оформления:

## Сертификат соответствия оформляется на:

- **Детскую мебель:** кровати, матрасы, шкафы
- **Офисную мебель:** столы, стулья, шкафы

## Необходимые документы

- Декларация соответствия ЕАЭС — от 15 000 ₽
- Сертификат пожарной безопасности — от 12 000 ₽

Пустая строка между абзацами. Жирный: **текст**. Заголовок: ## Название`;

function emptyCategory(slug: string, title: string): Category {
  const description = "";
  return {
    slug,
    title,
    description,
    body: "",
    documents: ["Декларация соответствия ЕАЭС"],
    seo: buildCategorySeo(title, description),
  };
}

function migrateRecordKey(
  record: Record<string, boolean>,
  from: string,
  to: string
): Record<string, boolean> {
  if (from === to || !(from in record)) return record;
  const next = { ...record };
  next[to] = next[from];
  delete next[from];
  return next;
}

export function CategoriesEditor() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [seoManual, setSeoManual] = useState<Record<string, boolean>>({});
  const seoManualRef = useRef(seoManual);
  seoManualRef.current = seoManual;
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<Category[]>("categories.json").then((data) => {
      setCategories(data);
      if (data.length > 0) setOpenIndex(0);
    });
  }, []);

  function update(index: number, patch: Partial<Category>) {
    setCategories((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );
  }

  function updateTitle(index: number, title: string) {
    let seoMigrate: { from: string; to: string } | null = null;

    setCategories((prev) => {
      const cat = prev[index];
      const otherSlugs = prev.filter((_, i) => i !== index).map((c) => c.slug);
      const newSlug = uniqueSlug(title, otherSlugs);

      if (newSlug !== cat.slug && seoManualRef.current[cat.slug]) {
        seoMigrate = { from: cat.slug, to: newSlug };
      }

      const patch: Partial<Category> = { title, slug: newSlug };
      if (!seoManualRef.current[cat.slug]) {
        patch.seo = buildCategorySeo(title, cat.description);
      }

      return prev.map((c, i) => (i === index ? { ...c, ...patch } : c));
    });

    if (seoMigrate) {
      setSeoManual((m) =>
        migrateRecordKey(m, seoMigrate!.from, seoMigrate!.to)
      );
    }
  }

  function updateDescription(index: number, description: string) {
    setCategories((prev) => {
      const cat = prev[index];
      const patch: Partial<Category> = { description };
      if (!seoManualRef.current[cat.slug]) {
        patch.seo = buildCategorySeo(cat.title, description);
      }
      return prev.map((c, i) => (i === index ? { ...c, ...patch } : c));
    });
  }

  function updateSeo(index: number, key: "title" | "description", value: string) {
    let slug = "";
    setCategories((prev) => {
      slug = prev[index].slug;
      return prev.map((c, i) =>
        i === index ? { ...c, seo: { ...c.seo, [key]: value } } : c
      );
    });
    setSeoManual((m) => ({ ...m, [slug]: true }));
  }

  function resetSeo(index: number) {
    let slug = "";
    setCategories((prev) => {
      const cat = prev[index];
      slug = cat.slug;
      return prev.map((c, i) =>
        i === index
          ? { ...c, seo: buildCategorySeo(cat.title, cat.description) }
          : c
      );
    });
    setSeoManual((m) => ({ ...m, [slug]: false }));
  }

  function updateDocument(catIndex: number, docIndex: number, value: string) {
    setCategories((prev) => {
      const docs = [...prev[catIndex].documents];
      docs[docIndex] = value;
      return prev.map((c, i) => (i === catIndex ? { ...c, documents: docs } : c));
    });
  }

  function addDocument(catIndex: number) {
    setCategories((prev) =>
      prev.map((c, i) =>
        i === catIndex ? { ...c, documents: [...c.documents, ""] } : c
      )
    );
  }

  function removeDocument(catIndex: number, docIndex: number) {
    setCategories((prev) =>
      prev.map((c, i) =>
        i === catIndex
          ? { ...c, documents: c.documents.filter((_, j) => j !== docIndex) }
          : c
      )
    );
  }

  function addCategory() {
    setCategories((prev) => {
      const title = "Новая категория";
      const slug = uniqueSlug(
        title,
        prev.map((c) => c.slug)
      );
      setOpenIndex(prev.length);
      return [...prev, emptyCategory(slug, title)];
    });
  }

  function removeCategory(index: number) {
    const cat = categories[index];
    if (
      !confirm(
        `Удалить категорию «${cat.title}»? Страница /produkciya/${cat.slug} перестанет работать.`
      )
    ) {
      return;
    }

    setCategories((prev) => prev.filter((_, i) => i !== index));
    setOpenIndex((current) => {
      if (current === null) return null;
      if (current === index) return Math.max(0, index - 1);
      if (current > index) return current - 1;
      return current;
    });
    setSeoManual((m) => {
      const copy = { ...m };
      delete copy[cat.slug];
      return copy;
    });
  }

  async function save() {
    const slugs = categories.map((c) => c.slug);
    if (slugs.length !== new Set(slugs).size) {
      alert("Есть повторяющиеся адреса. Проверьте названия категорий.");
      return;
    }
    if (categories.some((c) => !c.title.trim())) {
      alert("У каждой категории должно быть название.");
      return;
    }
    await run(() => saveContent("categories.json", categories));
  }

  if (categories.length === 0 && status === "idle") {
    return <p className="text-muted">Загрузка…</p>;
  }

  const cat = openIndex !== null ? categories[openIndex] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Каждая категория — отдельная страница. Адрес и SEO формируются из названия
          (SEO можно править вручную).
        </p>
        <button type="button" onClick={addCategory} className="btn-primary gap-2 px-4 py-2 text-sm">
          <Plus className="h-4 w-4" />
          Добавить категорию
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((item, index) => (
          <button
            key={`${index}-${item.slug}`}
            type="button"
            onClick={() => setOpenIndex(index)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              openIndex === index
                ? "bg-primary text-white"
                : "border border-border bg-white text-muted hover:border-primary/30"
            }`}
          >
            {item.title || "Без названия"}
          </button>
        ))}
      </div>

      {cat && openIndex !== null && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-primary-dark">
              {cat.title || "Новая категория"}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/produkciya/${cat.slug}`}
                target="_blank"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Открыть на сайте
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => removeCategory(openIndex)}
                className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </button>
            </div>
          </div>

          <AdminCard>
            <div className="grid gap-4">
              <Field label="Название категории">
                <TextInput
                  value={cat.title}
                  onChange={(e) => updateTitle(openIndex, e.target.value)}
                />
              </Field>
              <Field
                label="Адрес страницы"
                hint="Формируется автоматически из названия (латиница)"
              >
                <p className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted">
                  navicert.pro/produkciya/
                  <span className="font-medium text-foreground">{cat.slug}</span>
                </p>
              </Field>
              <Field
                label="Короткое описание"
                hint="Под заголовком на странице и в списках. Влияет на SEO-описание."
              >
                <TextArea
                  value={cat.description}
                  onChange={(e) => updateDescription(openIndex, e.target.value)}
                  className="min-h-[80px]"
                />
              </Field>
              <Field
                label="Основной текст страницы"
                hint="Заголовки ##, списки -, жирный **текст**"
              >
                <TextArea
                  value={cat.body || ""}
                  onChange={(e) => update(openIndex, { body: e.target.value })}
                  className="min-h-[280px] font-mono text-sm"
                  placeholder={FORMAT_HELP}
                />
              </Field>
              <details className="rounded-xl border border-border bg-background/50 p-4">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  Подсказка по форматированию
                </summary>
                <pre className="mt-3 whitespace-pre-wrap text-xs text-muted">{FORMAT_HELP}</pre>
              </details>
              {(cat.body || "").trim() && (
                <div>
                  <p className="mb-2 text-sm font-medium">Предпросмотр</p>
                  <div className="rounded-xl border border-border bg-background p-4 sm:p-6">
                    <MarkdownContent text={cat.body || ""} />
                  </div>
                </div>
              )}
            </div>
          </AdminCard>

          <AdminCard title="SEO">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                {seoManual[cat.slug]
                  ? "Ручной режим — поля не меняются при правке названия."
                  : "Обновляется автоматически из названия и короткого описания."}
              </p>
              <button
                type="button"
                onClick={() => resetSeo(openIndex)}
                className="btn-ghost gap-2 px-3 py-1.5 text-sm"
              >
                <Wand2 className="h-4 w-4" />
                Подтянуть из названия
              </button>
            </div>
            <div className="grid gap-4">
              <Field label="Заголовок в Google / Яндекс">
                <TextInput
                  value={cat.seo.title}
                  onChange={(e) => updateSeo(openIndex, "title", e.target.value)}
                />
              </Field>
              <Field label="Описание в поиске">
                <TextArea
                  value={cat.seo.description}
                  onChange={(e) => updateSeo(openIndex, "description", e.target.value)}
                  className="min-h-[80px]"
                />
              </Field>
            </div>
          </AdminCard>

          <AdminCard title="Необходимые документы">
            <p className="mb-4 text-sm text-muted">
              Карточки со значком под основным текстом. Можно указать цену:{" "}
              <code className="rounded bg-background px-1">
                Декларация ЕАЭС — от 15 000 ₽
              </code>
            </p>
            <div className="space-y-2">
              {cat.documents.map((doc, docIndex) => (
                <div key={docIndex} className="flex gap-2">
                  <TextInput
                    value={doc}
                    onChange={(e) => updateDocument(openIndex, docIndex, e.target.value)}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeDocument(openIndex, docIndex)}
                    className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addDocument(openIndex)}
                className="btn-ghost gap-2 px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4" />
                Добавить документ
              </button>
            </div>
          </AdminCard>
        </div>
      )}

      <SaveButton onClick={save} status={status} />
    </div>
  );
}
