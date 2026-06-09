"use client";

import { useEffect, useState } from "react";
import type { SiteConfig } from "@/lib/types";
import { loadContent, saveContent } from "./api";
import { AdminCard, Field, TextInput, TextArea, SaveButton, useSaveStatus } from "./ui";

export function SiteSettingsForm() {
  const [site, setSite] = useState<SiteConfig | null>(null);
  const { status, run } = useSaveStatus();

  useEffect(() => {
    loadContent<SiteConfig>("site.json").then(setSite);
  }, []);

  if (!site) {
    return <p className="text-muted">Загрузка…</p>;
  }

  function update<K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) {
    setSite({ ...site!, [key]: value });
  }

  function updateHero(key: keyof SiteConfig["hero"], value: string) {
    setSite({ ...site!, hero: { ...site!.hero, [key]: value } });
  }

  function updateSocial(key: keyof SiteConfig["social"], value: string) {
    setSite({ ...site!, social: { ...site!.social, [key]: value } });
  }

  function updateAddress(
    key: keyof NonNullable<SiteConfig["address"]>,
    value: string
  ) {
    const next = {
      locality: site!.address?.locality || "",
      region: site!.address?.region || "",
      country: site!.address?.country || "RU",
      [key]: value,
    };
    if (!next.locality.trim() && !next.region.trim()) {
      const { address: _, ...rest } = site!;
      setSite(rest as SiteConfig);
      return;
    }
    setSite({ ...site!, address: next });
  }

  async function save() {
    await run(() => saveContent("site.json", site));
  }

  return (
    <div className="space-y-6">
      <AdminCard
        title="Контакты"
        description="Телефон и почта отображаются в шапке, подвале и форме заявки."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Телефон (как на сайте)">
            <TextInput
              value={site.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </Field>
          <Field label="Телефон (для ссылок tel:)" hint="Без пробелов, например +79114729427">
            <TextInput
              value={site.phoneRaw}
              onChange={(e) => update("phoneRaw", e.target.value)}
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={site.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </Field>
        </div>
      </AdminCard>

      <AdminCard
        title="Главный экран"
        description="Заголовок и текст в первом блоке на главной странице."
      >
        <div className="grid gap-4">
          <Field label="Заголовок">
            <TextInput
              value={site.hero.title}
              onChange={(e) => updateHero("title", e.target.value)}
            />
          </Field>
          <Field label="Подзаголовок">
            <TextArea
              value={site.hero.subtitle}
              onChange={(e) => updateHero("subtitle", e.target.value)}
              className="min-h-[120px]"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Текст кнопки">
              <TextInput
                value={site.hero.cta}
                onChange={(e) => updateHero("cta", e.target.value)}
              />
            </Field>
            <Field label="Цена «от …»">
              <TextInput
                value={site.hero.priceFrom}
                onChange={(e) => updateHero("priceFrom", e.target.value)}
              />
            </Field>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Мессенджеры" description="Ссылки на Telegram, WhatsApp и MAX.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Telegram">
            <TextInput
              value={site.social.telegram}
              onChange={(e) => updateSocial("telegram", e.target.value)}
            />
          </Field>
          <Field label="WhatsApp">
            <TextInput
              value={site.social.whatsapp}
              onChange={(e) => updateSocial("whatsapp", e.target.value)}
            />
          </Field>
          <Field label="MAX">
            <TextInput
              value={site.social.max}
              onChange={(e) => updateSocial("max", e.target.value)}
            />
          </Field>
        </div>
      </AdminCard>

      <AdminCard
        title="Офис (необязательно)"
        description="Услуги дистанционные по всей России — поля можно оставить пустыми. Укажите город только если есть офис приёма клиентов; иначе в поиске не привязываемся к одному региону."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Город офиса">
            <TextInput
              value={site.address?.locality || ""}
              onChange={(e) => {
                const locality = e.target.value.trim();
                if (!locality && !site.address?.region?.trim()) {
                  const { address: _, ...rest } = site;
                  setSite(rest as SiteConfig);
                  return;
                }
                setSite({
                  ...site,
                  address: {
                    locality,
                    region: site.address?.region || "",
                    country: site.address?.country || "RU",
                  },
                });
              }}
            />
          </Field>
          <Field label="Регион">
            <TextInput
              value={site.address?.region || ""}
              onChange={(e) => updateAddress("region", e.target.value)}
            />
          </Field>
        </div>
      </AdminCard>

      <AdminCard
        title="Аналитика"
        description="Номер счётчика Яндекс.Метрики. Оставьте пустым, если не используете."
      >
        <Field label="ID счётчика Метрики" hint="Только цифры, например 12345678">
          <TextInput
            value={site.analytics?.yandexMetrikaId || ""}
            onChange={(e) =>
              setSite({
                ...site,
                analytics: { yandexMetrikaId: e.target.value },
              })
            }
          />
        </Field>
      </AdminCard>

      <SaveButton onClick={save} status={status} />
    </div>
  );
}
