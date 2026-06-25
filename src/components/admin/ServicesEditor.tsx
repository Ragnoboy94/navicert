"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, Trash2, Wand2 } from "lucide-react";
import type { Service } from "@/lib/types";
import { buildServiceSeo, uniqueSlug } from "@/lib/seo-content";
import { loadContent, saveContent } from "./api";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";
import { ImageUpload } from "./ImageUpload";

function emptyService(slug: string, title: string): Service {
  const description = "";
  return {
    slug,
    title,
    shortTitle: title,
    icon: "file-text",
    description,
    features: [],
    seo: buildServiceSeo(title, description),
    priceFrom: "",
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

export function ServicesEditor() {
  const [services, setServices] = useState<Service[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [seoManual, setSeoManual] = useState<Record<string, boolean>>({});
  const seoManualRef = useRef(seoManual);
  seoManualRef.current = seoManual;
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<Service[]>("services.json").then((data) => {
      setServices(data);
      if (data.length > 0) setOpenIndex(0);
    });
  }, []);

  function update(index: number, patch: Partial<Service>) {
    setServices((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  }

  function updateTitle(index: number, title: string) {
    let seoMigrate: { from: string; to: string } | null = null;

    setServices((prev) => {
      const service = prev[index];
      const otherSlugs = prev.filter((_, i) => i !== index).map((s) => s.slug);
      const newSlug = uniqueSlug(title, otherSlugs, "usluga");

      if (newSlug !== service.slug && seoManualRef.current[service.slug]) {
        seoMigrate = { from: service.slug, to: newSlug };
      }

      const patch: Partial<Service> = { title, slug: newSlug };
      if (!seoManualRef.current[service.slug]) {
        patch.seo = buildServiceSeo(title, service.description, service.priceFrom);
      }

      return prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
    });

    if (seoMigrate) {
      setSeoManual((m) =>
        migrateRecordKey(m, seoMigrate!.from, seoMigrate!.to)
      );
    }
  }

  function updateDescription(index: number, description: string) {
    setServices((prev) => {
      const service = prev[index];
      const patch: Partial<Service> = { description };
      if (!seoManualRef.current[service.slug]) {
        patch.seo = buildServiceSeo(
          service.title,
          description,
          service.priceFrom
        );
      }
      return prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
    });
  }

  function updatePrice(index: number, priceFrom: string) {
    setServices((prev) => {
      const service = prev[index];
      const patch: Partial<Service> = { priceFrom };
      if (!seoManualRef.current[service.slug]) {
        patch.seo = buildServiceSeo(
          service.title,
          service.description,
          priceFrom
        );
      }
      return prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
    });
  }

  function updateSeo(index: number, key: "title" | "description", value: string) {
    let slug = "";
    setServices((prev) => {
      slug = prev[index].slug;
      return prev.map((s, i) =>
        i === index ? { ...s, seo: { ...s.seo, [key]: value } } : s
      );
    });
    setSeoManual((m) => ({ ...m, [slug]: true }));
  }

  function resetSeo(index: number) {
    let slug = "";
    setServices((prev) => {
      const service = prev[index];
      slug = service.slug;
      return prev.map((s, i) =>
        i === index
          ? {
              ...s,
              seo: buildServiceSeo(
                service.title,
                service.description,
                service.priceFrom
              ),
            }
          : s
      );
    });
    setSeoManual((m) => ({ ...m, [slug]: false }));
  }

  function updateFeature(serviceIndex: number, featureIndex: number, value: string) {
    setServices((prev) => {
      const features = [...prev[serviceIndex].features];
      features[featureIndex] = value;
      return prev.map((s, i) =>
        i === serviceIndex ? { ...s, features } : s
      );
    });
  }

  function addFeature(serviceIndex: number) {
    setServices((prev) =>
      prev.map((s, i) =>
        i === serviceIndex ? { ...s, features: [...s.features, ""] } : s
      )
    );
  }

  function removeFeature(serviceIndex: number, featureIndex: number) {
    setServices((prev) =>
      prev.map((s, i) =>
        i === serviceIndex
          ? { ...s, features: s.features.filter((_, j) => j !== featureIndex) }
          : s
      )
    );
  }

  function addService() {
    setServices((prev) => {
      const title = "Новая услуга";
      const slug = uniqueSlug(
        title,
        prev.map((s) => s.slug),
        "usluga"
      );
      setOpenIndex(prev.length);
      return [...prev, emptyService(slug, title)];
    });
  }

  function removeService(index: number) {
    const service = services[index];
    if (
      !confirm(
        `Удалить услугу «${service.title}»? Страница /uslugi/${service.slug} перестанет работать.`
      )
    ) {
      return;
    }

    setServices((prev) => prev.filter((_, i) => i !== index));
    setOpenIndex((current) => {
      if (current === null) return null;
      if (current === index) return Math.max(0, index - 1);
      if (current > index) return current - 1;
      return current;
    });
    setSeoManual((m) => {
      const copy = { ...m };
      delete copy[service.slug];
      return copy;
    });
  }

  async function save() {
    const slugs = services.map((s) => s.slug);
    if (slugs.length !== new Set(slugs).size) {
      alert("Есть повторяющиеся адреса. Проверьте названия услуг.");
      return;
    }
    if (services.some((s) => !s.title.trim())) {
      alert("У каждой услуги должно быть название.");
      return;
    }
    await run(() => saveContent("services.json", services));
  }

  if (services.length === 0 && status === "idle") {
    return <p className="text-muted">Загрузка…</p>;
  }

  const service = openIndex !== null ? services[openIndex] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Каждая услуга — отдельная страница. Адрес и SEO формируются из названия
          (SEO можно править вручную). Цена:{" "}
          <code className="rounded bg-background px-1">от 15 000 ₽</code>
        </p>
        <button type="button" onClick={addService} className="btn-primary gap-2 px-4 py-2 text-sm">
          <Plus className="h-4 w-4" />
          Добавить услугу
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {services.map((item, index) => (
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
            {item.shortTitle || item.title || "Без названия"}
          </button>
        ))}
      </div>

      {service && openIndex !== null && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-primary-dark">
              {service.title || "Новая услуга"}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/uslugi/${service.slug}`}
                target="_blank"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Открыть на сайте
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => removeService(openIndex)}
                className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </button>
            </div>
          </div>

          <AdminCard>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Полное название">
                <TextInput
                  value={service.title}
                  onChange={(e) => updateTitle(openIndex, e.target.value)}
                />
              </Field>
              <Field label="Короткое название" hint="В списках и на главной">
                <TextInput
                  value={service.shortTitle}
                  onChange={(e) => update(openIndex, { shortTitle: e.target.value })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Адрес страницы"
                  hint="Формируется автоматически из названия (латиница)"
                >
                  <p className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted">
                    navicert.pro/uslugi/
                    <span className="font-medium text-foreground">{service.slug}</span>
                  </p>
                </Field>
              </div>
              <Field label="Цена «от …»">
                <TextInput
                  value={service.priceFrom}
                  onChange={(e) => updatePrice(openIndex, e.target.value)}
                  placeholder="от 15 000 ₽"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Фото на странице услуги"
                  hint="Показывается в шапке страницы услуги. Можно загрузить файл — сохранится на сервере."
                >
                  <ImageUpload
                    value={service.image}
                    onChange={(url) => update(openIndex, { image: url })}
                    name={`service-${service.slug}`}
                    folder="uploads"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Описание" hint="На странице услуги и в карточках">
                  <TextArea
                    value={service.description}
                    onChange={(e) => updateDescription(openIndex, e.target.value)}
                    className="min-h-[100px]"
                  />
                </Field>
              </div>
            </div>
          </AdminCard>

          <AdminCard title="Что входит в услугу">
            <p className="mb-4 text-sm text-muted">
              Пункты со значком на странице услуги.
            </p>
            <div className="space-y-2">
              {service.features.map((feature, featureIndex) => (
                <div key={featureIndex} className="flex gap-2">
                  <TextInput
                    value={feature}
                    onChange={(e) =>
                      updateFeature(openIndex, featureIndex, e.target.value)
                    }
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeFeature(openIndex, featureIndex)}
                    className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addFeature(openIndex)}
                className="btn-ghost gap-2 px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4" />
                Добавить пункт
              </button>
            </div>
          </AdminCard>

          <AdminCard title="SEO">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                {seoManual[service.slug]
                  ? "Ручной режим — поля не меняются при правке названия."
                  : "Обновляется автоматически из названия, описания и цены."}
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
                  value={service.seo.title}
                  onChange={(e) => updateSeo(openIndex, "title", e.target.value)}
                />
              </Field>
              <Field label="Описание в поиске">
                <TextArea
                  value={service.seo.description}
                  onChange={(e) => updateSeo(openIndex, "description", e.target.value)}
                  className="min-h-[80px]"
                />
              </Field>
            </div>
          </AdminCard>
        </div>
      )}

      <SaveButton onClick={save} status={status} />
    </div>
  );
}
