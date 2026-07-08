"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { OutreachPanel } from "./OutreachPanel";

type MailingTab = "expiring";

type TabDef = {
  id: MailingTab;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
};

const tabs: TabDef[] = [
  {
    id: "expiring",
    label: "Заканчивающиеся",
    description: "Декларации с истекающим сроком в реестре ФСА",
    icon: Clock,
    enabled: true,
  },
];

export function MailingsPanel() {
  const [activeTab, setActiveTab] = useState<MailingTab>("expiring");
  const current = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

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
              onClick={() => tab.enabled && setActiveTab(tab.id)}
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

      {activeTab === "expiring" && <OutreachPanel />}
    </div>
  );
}
