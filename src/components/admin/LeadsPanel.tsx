"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Phone, Mail, MessageSquare, Calendar } from "lucide-react";
import type { Lead } from "@/lib/types";
import { loadLeads } from "./api";
import { AdminCard } from "./ui";

export function LeadsPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setLeads(await loadLeads());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Заявки с формы на сайте. Новые приходят сразу после отправки клиентом.
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="btn-ghost gap-2 px-4 py-2 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      {leads.length === 0 ? (
        <AdminCard>
          <p className="py-8 text-center text-muted">
            Заявок пока нет — они появятся здесь, когда кто-то заполнит форму на сайте.
          </p>
        </AdminCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {leads
            .slice()
            .reverse()
            .map((lead) => (
              <AdminCard key={lead.id} className="!p-0">
                <div className="p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-primary-dark">
                        {lead.name}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(lead.createdAt).toLocaleString("ru-RU")}
                      </p>
                    </div>
                    {lead.service && (
                      <span className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-primary">
                        {lead.service}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 text-sm">
                    <a
                      href={`tel:${lead.phone}`}
                      className="flex items-center gap-2 font-medium text-primary hover:underline"
                    >
                      <Phone className="h-4 w-4 text-accent" />
                      {lead.phone}
                    </a>
                    {lead.email && (
                      <a
                        href={`mailto:${lead.email}`}
                        className="flex items-center gap-2 text-muted hover:text-primary"
                      >
                        <Mail className="h-4 w-4" />
                        {lead.email}
                      </a>
                    )}
                    {lead.message && (
                      <p className="flex gap-2 rounded-xl bg-background p-3 text-muted">
                        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                        {lead.message}
                      </p>
                    )}
                  </div>
                </div>
              </AdminCard>
            ))}
        </div>
      )}

      <AdminCard title="Таблица (для копирования)">
        <div className="overflow-x-auto -mx-5 sm:-mx-6">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-background text-left text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Дата</th>
                <th className="px-5 py-3 font-medium">Имя</th>
                <th className="px-5 py-3 font-medium">Телефон</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Услуга</th>
              </tr>
            </thead>
            <tbody>
              {leads
                .slice()
                .reverse()
                .map((lead) => (
                  <tr key={lead.id} className="border-t border-border">
                    <td className="px-5 py-3 whitespace-nowrap">
                      {new Date(lead.createdAt).toLocaleString("ru-RU")}
                    </td>
                    <td className="px-5 py-3 font-medium">{lead.name}</td>
                    <td className="px-5 py-3">{lead.phone}</td>
                    <td className="px-5 py-3">{lead.email || "—"}</td>
                    <td className="px-5 py-3">{lead.service || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </AdminCard>
    </div>
  );
}
