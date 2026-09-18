"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Phone,
  Mail,
  MessageSquare,
  Calendar,
  Search,
} from "lucide-react";
import type { Lead } from "@/lib/types";
import { loadLeads } from "./api";
import { AdminCard, Field } from "./ui";

type Period = "all" | "today" | "week";

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sourceLabel(source: string) {
  if (source === "homepage") return "Главная";
  if (source === "kalkulyator" || source === "yandex-direct") {
    return "Калькулятор";
  }
  if (source === "local-seed") return "Тест";
  if (source === "uslugi") return "Услуги";
  return source || "Сайт";
}

function StatChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl p-4 text-left transition ${
        active
          ? "bg-gradient-to-r from-accent-soft to-white shadow-sm ring-2 ring-accent"
          : "bg-background hover:bg-accent-soft/30"
      }`}
    >
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{count}</p>
    </button>
  );
}

const PAGE_SIZE = 12;

export function LeadsPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [page, setPage] = useState(1);

  async function refresh() {
    setLoading(true);
    setLeads(await loadLeads());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const todayStart = startOfTodayMs();
  const weekStart = todayStart - 6 * 24 * 3600_000;

  const counts = useMemo(() => {
    let today = 0;
    let week = 0;
    for (const lead of leads) {
      const t = Date.parse(lead.createdAt);
      if (t >= todayStart) today += 1;
      if (t >= weekStart) week += 1;
    }
    return { all: leads.length, today, week };
  }, [leads, todayStart, weekStart]);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const lead of leads) {
      if (lead.service?.trim()) set.add(lead.service.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const created = Date.parse(lead.createdAt);
      if (period === "today" && created < todayStart) return false;
      if (period === "week" && created < weekStart) return false;
      if (serviceFilter !== "all" && (lead.service || "") !== serviceFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [
        lead.name,
        lead.phone,
        lead.email,
        lead.message,
        lead.service,
        lead.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [leads, period, query, serviceFilter, todayStart, weekStart]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [query, period, serviceFilter]);

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

      <div className="grid gap-3 sm:grid-cols-3">
        <StatChip
          label="Все заявки"
          count={counts.all}
          active={period === "all"}
          onClick={() => setPeriod("all")}
        />
        <StatChip
          label="Сегодня"
          count={counts.today}
          active={period === "today"}
          onClick={() => setPeriod("today")}
        />
        <StatChip
          label="За 7 дней"
          count={counts.week}
          active={period === "week"}
          onClick={() => setPeriod("week")}
        />
      </div>

      <AdminCard className="!p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Поиск">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Имя, телефон, email или текст заявки"
                  className="input-field"
                  style={{ paddingLeft: "2.5rem" }}
                />
              </div>
            </Field>
          </div>
          <div className="w-full shrink-0 sm:w-52">
            <Field label="Услуга">
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="input-field"
              >
                <option value="all">Все услуги</option>
                {services.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </AdminCard>

      {leads.length === 0 ? (
        <AdminCard>
          <p className="py-8 text-center text-muted">
            Заявок пока нет — они появятся здесь, когда кто-то заполнит форму на
            сайте.
          </p>
        </AdminCard>
      ) : filtered.length === 0 ? (
        <AdminCard>
          <p className="py-8 text-center text-muted">
            По выбранным фильтрам заявок нет.
          </p>
        </AdminCard>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pageItems.map((lead) => (
              <AdminCard key={lead.id} className="!p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-primary-dark">
                      {lead.name}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {new Date(lead.createdAt).toLocaleString("ru-RU")}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {sourceLabel(lead.source)}
                    </p>
                  </div>
                  {lead.service ? (
                    <span className="line-clamp-2 max-w-[40%] shrink-0 rounded-lg bg-accent-soft px-2 py-1 text-[11px] font-medium leading-snug text-primary">
                      {lead.service}
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1.5 text-sm">
                  <a
                    href={`tel:${lead.phone}`}
                    className="flex items-center gap-2 font-medium text-primary hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate">{lead.phone}</span>
                  </a>
                  {lead.email ? (
                    <a
                      href={`mailto:${lead.email}`}
                      className="flex items-center gap-2 text-muted hover:text-primary"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{lead.email}</span>
                    </a>
                  ) : null}
                  {lead.message ? (
                    <p className="line-clamp-3 flex gap-2 rounded-lg bg-background p-2 text-xs text-muted">
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{lead.message}</span>
                    </p>
                  ) : null}
                </div>
              </AdminCard>
            ))}
          </div>

          {pageCount > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Показано {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, filtered.length)} из{" "}
                {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
                >
                  Назад
                </button>
                <span className="text-sm tabular-nums text-muted">
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
                >
                  Дальше
                </button>
              </div>
            </div>
          ) : null}

          <AdminCard
            title="Таблица (для копирования)"
            description="Отфильтрованные заявки текущей выборки — удобно выделить и скопировать."
          >
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
                  {filtered.map((lead) => (
                    <tr key={lead.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-5 py-3">
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
        </>
      )}
    </div>
  );
}
