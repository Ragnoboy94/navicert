"use client";

import { useEffect, useState } from "react";
import type { Service } from "@/lib/types";
import { loadContent, saveContent } from "./api";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";

export function ServicesEditor() {
  const [services, setServices] = useState<Service[]>([]);
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<Service[]>("services.json").then(setServices);
  }, []);

  function update(index: number, patch: Partial<Service>) {
    setServices(services.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function updateSeo(index: number, key: "title" | "description", value: string) {
    const service = services[index];
    update(index, {
      seo: { ...service.seo, [key]: value },
    });
  }

  async function save() {
    await run(() => saveContent("services.json", services));
  }

  if (services.length === 0) {
    return <p className="text-muted">Загрузка…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Цены отображаются на главной, в списке услуг и на странице каждой услуги. Формат:{" "}
        <code className="rounded bg-background px-1">от 15 000 ₽</code>
      </p>

      {services.map((service, index) => (
        <AdminCard key={service.slug}>
          <p className="mb-4 text-sm font-bold text-primary-dark">{service.title}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Короткое название">
              <TextInput
                value={service.shortTitle}
                onChange={(e) => update(index, { shortTitle: e.target.value })}
              />
            </Field>
            <Field label="Цена «от …»">
              <TextInput
                value={service.priceFrom}
                onChange={(e) => update(index, { priceFrom: e.target.value })}
                placeholder="от 15 000 ₽"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="SEO — заголовок">
                <TextInput
                  value={service.seo.title}
                  onChange={(e) => updateSeo(index, "title", e.target.value)}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="SEO — описание">
                <TextArea
                  value={service.seo.description}
                  onChange={(e) => updateSeo(index, "description", e.target.value)}
                  className="min-h-[80px]"
                />
              </Field>
            </div>
          </div>
        </AdminCard>
      ))}

      <SaveButton onClick={save} status={status} />
    </div>
  );
}
