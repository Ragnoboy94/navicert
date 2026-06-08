"use client";

import { useEffect, useState } from "react";
import {
  Lock,
  LogOut,
  Inbox,
  ExternalLink,
  LayoutDashboard,
  Phone,
  Star,
  HelpCircle,
  TrendingUp,
  Code2,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { SiteSettingsForm } from "@/components/admin/SiteSettingsForm";
import { ReviewsEditor } from "@/components/admin/ReviewsEditor";
import { FaqEditor } from "@/components/admin/FaqEditor";
import { CasesEditor } from "@/components/admin/CasesEditor";
import { LeadsPanel } from "@/components/admin/LeadsPanel";
import { DevJsonEditor } from "@/components/admin/DevJsonEditor";
import { loadLeads } from "@/components/admin/api";
import { AdminCard } from "@/components/admin/ui";

type AdminSection =
  | "dashboard"
  | "site"
  | "reviews"
  | "faq"
  | "cases"
  | "leads"
  | "dev";

const nav: {
  id: AdminSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    id: "dashboard",
    label: "Главная",
    icon: LayoutDashboard,
    description: "Обзор и подсказки",
  },
  {
    id: "site",
    label: "Контакты и главная",
    icon: Phone,
    description: "Телефон, почта, заголовки",
  },
  {
    id: "reviews",
    label: "Отзывы",
    icon: Star,
    description: "Отзывы клиентов",
  },
  {
    id: "faq",
    label: "Вопросы и ответы",
    icon: HelpCircle,
    description: "Блок FAQ на сайте",
  },
  {
    id: "cases",
    label: "Кейсы",
    icon: TrendingUp,
    description: "Результаты с цифрами",
  },
  {
    id: "leads",
    label: "Заявки",
    icon: Inbox,
    description: "Обращения с формы",
  },
  {
    id: "dev",
    label: "Для разработчика",
    icon: Code2,
    description: "Редактор JSON",
  },
];

function Dashboard({
  leadsCount,
  onNavigate,
}: {
  leadsCount: number;
  onNavigate: (id: AdminSection) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminCard className="!p-5">
          <p className="text-sm text-muted">Новых заявок</p>
          <p className="mt-1 text-3xl font-bold text-primary">{leadsCount}</p>
          <button
            type="button"
            onClick={() => onNavigate("leads")}
            className="mt-3 inline-flex items-center text-sm font-medium text-accent"
          >
            Смотреть заявки
            <ChevronRight className="h-4 w-4" />
          </button>
        </AdminCard>
        <AdminCard className="!p-5">
          <p className="text-sm text-muted">Сайт</p>
          <p className="mt-1 text-lg font-bold text-primary-dark">navicert.pro</p>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent"
          >
            Открыть сайт
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </AdminCard>
        <AdminCard className="!p-5 sm:col-span-2 lg:col-span-1">
          <p className="text-sm text-muted">Подсказка</p>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            После сохранения изменений обновите страницу сайта (F5), чтобы увидеть результат.
          </p>
        </AdminCard>
      </div>

      <AdminCard
        title="Что можно редактировать"
        description="Всё необходимое — без знания кода."
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {nav
            .filter((n) => n.id !== "dashboard" && n.id !== "dev")
            .map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-xl bg-background p-4"
              >
                <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-sm text-muted">{item.description}</p>
                </div>
              </li>
            ))}
        </ul>
      </AdminCard>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [files, setFiles] = useState<string[]>([]);
  const [leadsCount, setLeadsCount] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const res = await fetch("/api/admin/content");
    setAuthed(res.ok);
    if (res.ok) {
      const data = await res.json();
      setFiles(data.files || []);
      const leads = await loadLeads();
      setLeadsCount(leads.length);
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthed(true);
      checkAuth();
    } else {
      setLoginError("Неверный пароль");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthed(false);
  }

  function goTo(id: AdminSection) {
    setSection(id);
    setMobileNav(false);
  }

  const current = nav.find((n) => n.id === section)!;

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#eef2f8] via-white to-accent-soft/30 px-4">
        <form
          onSubmit={login}
          className="w-full max-w-md rounded-3xl border border-border bg-white p-8 shadow-xl"
        >
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-primary text-white shadow-lg">
              <Lock className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-primary-dark">
                Панель Нависерт
              </h1>
              <p className="text-sm text-muted">Вход для сотрудников</p>
            </div>
          </div>
          <label className="mb-1.5 block text-sm font-medium">Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
            placeholder="Введите пароль"
            autoFocus
          />
          {loginError && (
            <p className="mt-2 text-sm text-red-600">{loginError}</p>
          )}
          <button type="submit" className="btn-primary mt-6 w-full py-3.5">
            Войти
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {mobileNav && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileNav(false)}
          aria-label="Закрыть меню"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-white p-5 shadow-xl transition-transform lg:static lg:translate-x-0 lg:shadow-none ${
          mobileNav ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-xl font-bold text-primary-dark">Нависерт</p>
            <p className="text-xs text-muted">Управление сайтом</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 lg:hidden"
            onClick={() => setMobileNav(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goTo(item.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${
                section === item.id
                  ? "bg-gradient-to-r from-accent-soft to-white font-semibold text-primary shadow-sm"
                  : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.id === "leads" && leadsCount > 0 && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">
                  {leadsCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-6 space-y-2 border-t border-border pt-6">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost flex w-full justify-center gap-2 py-2.5 text-sm"
          >
            <ExternalLink className="h-4 w-4" />
            Открыть сайт
          </a>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm text-muted transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-border bg-white/90 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
          <button
            type="button"
            className="rounded-xl border border-border p-2 lg:hidden"
            onClick={() => setMobileNav(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-primary-dark sm:text-xl">
              {current.label}
            </h1>
            <p className="truncate text-sm text-muted">{current.description}</p>
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          {section === "dashboard" && (
            <Dashboard leadsCount={leadsCount} onNavigate={goTo} />
          )}
          {section === "site" && <SiteSettingsForm />}
          {section === "reviews" && <ReviewsEditor />}
          {section === "faq" && <FaqEditor />}
          {section === "cases" && <CasesEditor />}
          {section === "leads" && <LeadsPanel />}
          {section === "dev" && <DevJsonEditor files={files} />}
        </div>
      </main>
    </div>
  );
}
