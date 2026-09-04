"use client";

import { useState } from "react";
import { Building2, Clock, Store } from "lucide-react";
import { OutreachPanel } from "./OutreachPanel";
import type { OutreachCategory } from "@/lib/outreach/types";

type MailingTab = "expiring" | "certificates" | "new_registrations" | "wb_sellers";

type TabDef = {
  id: MailingTab;
  category: OutreachCategory;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
};

const tabs: TabDef[] = [
  {
    id: "expiring",
    category: "expiring",
    label: "Заканчивающиеся декларации",
    description: "Декларации с истекающим сроком в реестре ФСА",
    icon: Clock,
    enabled: true,
  },
  {
    id: "certificates",
    category: "expiring_certificates",
    label: "Заканчивающиеся сертификаты",
    description: "Сертификаты с истекающим сроком в реестре ФСА",
    icon: Clock,
    enabled: true,
  },
  {
    id: "new_registrations",
    category: "new_registrations",
    label: "Новые организации",
    description:
      "Компании с датой регистрации за последние 21 день (checko.ru)",
    icon: Building2,
    enabled: true,
  },
  {
    id: "wb_sellers",
    category: "wb_sellers",
    label: "Продавцы Wildberries",
    description: "Продавцы на Wildberries",
    icon: Store,
    enabled: true,
  },
];

export function MailingsPanel() {
  const [activeTab, setActiveTab] = useState<MailingTab>("expiring");
  /** Уже открытые вкладки не размонтируем — иначе очередь грузится заново. */
  const [mountedTabs, setMountedTabs] = useState<Record<MailingTab, boolean>>({
    expiring: true,
    certificates: false,
    new_registrations: false,
    wb_sellers: false,
  });
  const current = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  function selectTab(id: MailingTab) {
    setMountedTabs((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    setActiveTab(id);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-2">
        <div
          className="flex gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Виды рассылок"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              disabled={!tab.enabled}
              onClick={() => tab.enabled && selectTab(tab.id)}
              className={`inline-flex min-w-fit items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-accent-soft to-white text-primary shadow-sm"
                  : "text-muted hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              }`}
            >
              <tab.icon className="h-4 w-4 shrink-0" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted">{current.description}</p>

      {tabs.map((tab) =>
        mountedTabs[tab.id] ? (
          <div
            key={tab.id}
            role="tabpanel"
            hidden={activeTab !== tab.id}
            className={activeTab === tab.id ? undefined : "hidden"}
          >
            <OutreachPanel
              category={tab.category}
              active={activeTab === tab.id}
            />
          </div>
        ) : null
      )}
    </div>
  );
}
