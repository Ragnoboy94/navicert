"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Mail,
  Power,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { AdminCard } from "./ui";
import { MAX_BATCH_SEND, MAX_DAILY_SEND } from "@/lib/outreach/limits";

type QueueItem = {
  id: number;
  number: string;
  registrationDate: string;
  endDate: string;
  productName: string;
  alreadySent: boolean;
  recipientAlreadySent: boolean;
  unsubscribed: boolean;
  sendable: boolean;
  autoSendable?: boolean;
  excludeFromAutoSend?: boolean;
  blockLabel?: string;
  rejectLabel?: string;
  applicant: {
    shortName?: string;
    fullName?: string;
    email?: string;
  };
};

type UnsubscribedItem = {
  id: string;
  email: string;
  companyName?: string;
  categoryLabel: string;
  unsubscribedAt: string;
};

type SentRecord = {
  declarationId: number;
  companyName: string;
  originalRecipient: string;
  sentAt: string;
  testMode: boolean;
};

type ListFilter = "eligible" | "pending" | "rejected" | "sent";

type OutreachSchedule = {
  enabled: boolean;
  emailsPerDay: number;
  lastRunAt: string | null;
  lastRunSent: number;
  lastFsaSyncAt: string | null;
};

type ScheduleStats = {
  sentToday: number;
  remainingToday: number;
  perRunLimit: number;
  runsToday: number;
  workHoursLabel: string;
  nextRunLabel: string;
};

type EnrichStatus = {
  running: boolean;
  stopping: boolean;
  paused: boolean;
  pending: number;
  processedTotal: number;
  emailsFoundTotal: number;
  lastBatchAt: string | null;
  lastError: string | null;
};

type OutreachState = {
  categoryLabel: string;
  range: { from: string; to: string };
  scannedAt: string | null;
  nextApiPage: number;
  pageSize: number;
  hasMore: boolean;
  enrichPending: number;
  enrichStatus: EnrichStatus;
  testMode: boolean;
  testEmail: string | null;
  items: QueueItem[];
  rejected: QueueItem[];
  sendableCount: number;
  unsubscribed: UnsubscribedItem[];
  sentCount: number;
  sent: SentRecord[];
  recentSent: SentRecord[];
  schedule: OutreachSchedule;
  scheduleStats: ScheduleStats;
};

const INITIAL_LOAD_MAX = 1000;
const APPEND_LOAD_MAX = 100;

const filterMeta: Record<
  ListFilter,
  { label: string; description: string; empty: string }
> = {
  eligible: {
    label: "К отправке",
    description: "Все компании с корпоративным email в очереди",
    empty: "Нет подходящих компаний для отправки",
  },
  pending: {
    label: "Готовы к отправке",
    description:
      "Уникальные адреса для авто- и пакетной отправки (исключённые — только вручную)",
    empty: "Нет готовых адресов — возможно, на них уже писали или это дубликаты",
  },
  rejected: {
    label: "Личные ящики",
    description: "Email есть, но mail.ru / gmail / yandex — можно отправить вручную",
    empty: "Нет адресов на личных почтовых сервисах",
  },
  sent: {
    label: "История отправок",
    description: "Все отправленные письма по этой рассылке",
    empty: "Писем ещё не отправляли",
  },
};

function isAutoSendableRow(item: QueueItem) {
  return item.autoSendable ?? (item.sendable && !item.excludeFromAutoSend);
}

function statusBadge(item: QueueItem) {
  if (item.excludeFromAutoSend) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
        только вручную
      </span>
    );
  }
  if (!item.sendable && item.blockLabel) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        {item.blockLabel}
      </span>
    );
  }
  if (item.unsubscribed) {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        отказался от писем
      </span>
    );
  }
  if (item.alreadySent) {
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
        отправлено
      </span>
    );
  }
  if (item.recipientAlreadySent) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        этому email уже писали
      </span>
    );
  }
  return (
    <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">
      в очереди
    </span>
  );
}

function StatFilterButton({
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
          ? "bg-gradient-to-r from-accent-soft to-white ring-2 ring-accent shadow-sm"
          : "bg-background hover:bg-accent-soft/30"
      }`}
    >
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{count}</p>
      <p className="mt-1 text-xs text-muted">
        {active ? "показан список ниже" : "нажмите, чтобы открыть"}
      </p>
    </button>
  );
}

function QueueTable({
  rows,
  showRejectReason,
  onSendOne,
  sendingId,
  manualSend = false,
  onToggleAutoExclude,
  togglingId,
}: {
  rows: QueueItem[];
  showRejectReason?: boolean;
  onSendOne?: (id: number) => void;
  sendingId?: number | null;
  manualSend?: boolean;
  onToggleAutoExclude?: (id: number, exclude: boolean) => void;
  togglingId?: number | null;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Список пуст</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="px-3 py-2 font-medium">Компания</th>
            <th className="px-3 py-2 font-medium">Регистрация</th>
            <th className="px-3 py-2 font-medium">Окончание</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Продукция</th>
            {showRejectReason && (
              <th className="px-3 py-2 font-medium">Причина</th>
            )}
            <th className="px-3 py-2 font-medium">Статус</th>
            {onToggleAutoExclude && (
              <th className="px-3 py-2 font-medium w-10" aria-label="Авто" />
            )}
            {onSendOne && <th className="px-3 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.id}
              className={`border-b border-border/70 ${item.excludeFromAutoSend ? "opacity-80" : ""}`}
            >
              <td className="px-3 py-3 font-medium">
                {item.applicant?.shortName || item.applicant?.fullName || "—"}
              </td>
              <td className="px-3 py-3 whitespace-nowrap">
                {item.registrationDate || "—"}
              </td>
              <td className="px-3 py-3 whitespace-nowrap">{item.endDate}</td>
              <td className="px-3 py-3">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-muted" />
                  {item.applicant?.email || "—"}
                </span>
              </td>
              <td className="max-w-xs truncate px-3 py-3 text-muted">
                {item.productName}
              </td>
              {showRejectReason && (
                <td className="px-3 py-3 text-xs text-muted">
                  {item.rejectLabel ?? "—"}
                </td>
              )}
              <td className="px-3 py-3">{statusBadge(item)}</td>
              {onToggleAutoExclude && (
                <td className="px-2 py-3">
                  <button
                    type="button"
                    disabled={togglingId === item.id}
                    onClick={() =>
                      onToggleAutoExclude(item.id, !item.excludeFromAutoSend)
                    }
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition ${
                      item.excludeFromAutoSend
                        ? "border-accent bg-accent-soft text-accent hover:bg-accent/10"
                        : "border-border text-muted hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                    } disabled:opacity-40`}
                    title={
                      item.excludeFromAutoSend
                        ? "Вернуть в автоматическую отправку"
                        : "Исключить из автоматической отправки (останется только ручная)"
                    }
                    aria-label={
                      item.excludeFromAutoSend
                        ? "Вернуть в автоматическую отправку"
                        : "Исключить из автоматической отправки"
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
              {onSendOne && (
                <td className="px-3 py-3">
                  <button
                    type="button"
                    disabled={
                      sendingId === item.id ||
                      (manualSend
                        ? !item.applicant?.email || item.unsubscribed
                        : !item.sendable)
                    }
                    onClick={() => onSendOne(item.id)}
                    className="btn-ghost gap-1 px-2 py-1 text-xs disabled:opacity-40"
                    title={
                      !manualSend && !item.sendable
                        ? item.blockLabel
                        : undefined
                    }
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendingId === item.id ? "…" : "Отправить"}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SentTable({ rows }: { rows: SentRecord[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Список пуст</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="px-3 py-2 font-medium">Дата</th>
            <th className="px-3 py-2 font-medium">Компания</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={`${item.declarationId}-${item.sentAt}`}
              className="border-b border-border/70"
            >
              <td className="px-3 py-3 whitespace-nowrap">
                {new Date(item.sentAt).toLocaleString("ru-RU")}
              </td>
              <td className="px-3 py-3">{item.companyName}</td>
              <td className="px-3 py-3">{item.originalRecipient}</td>
              <td className="px-3 py-3 text-muted">{item.declarationId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OutreachPanel() {
  const [data, setData] = useState<OutreachState | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [appending, setAppending] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [sendCount, setSendCount] = useState(10);
  const [emailsPerDay, setEmailsPerDay] = useState(50);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleAction, setScheduleAction] = useState<
    "enable" | "disable" | "limit" | null
  >(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("pending");
  const listRef = useRef<HTMLDivElement>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    const res = await fetch("/api/admin/outreach", { credentials: "same-origin" });
    if (!res.ok) {
      if (!silent) setError("Не удалось загрузить данные рассылки");
      if (!silent) setLoading(false);
      return;
    }
    const json = await res.json();
    setData(json);
    if (json.schedule) {
      setEmailsPerDay(json.schedule.emailsPerDay ?? 50);
    }
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/outreach", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError("Не удалось загрузить данные рассылки");
        setLoading(false);
        return;
      }
      const json = await res.json();
      setData(json);
      if (json.schedule) {
        setEmailsPerDay(json.schedule.emailsPerDay ?? 50);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const running = data?.enrichStatus?.running;
    const stopping = data?.enrichStatus?.stopping;
    const pending = data?.enrichPending ?? 0;
    if (!running && !stopping && pending === 0) return;

    const timer = setInterval(() => {
      void refresh(true);
    }, 10_000);

    return () => clearInterval(timer);
  }, [
    data?.enrichStatus?.running,
    data?.enrichStatus?.stopping,
    data?.enrichPending,
  ]);

  async function startBackgroundEnrich(resetCounters = false) {
    setError("");
    const res = await fetch("/api/admin/outreach/enrich", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true, resetCounters }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Не удалось запустить фоновое обогащение");
      return;
    }
    if (json.lastError) {
      setError(json.lastError);
    }
    await refresh(true);
  }

  async function stopEnrich() {
    setMessage(
      "Останавливаем… текущий батч (до ~2 мин) может ещё завершиться."
    );
    await fetch("/api/admin/outreach/enrich", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    await refresh(true);
  }

  function selectFilter(filter: ListFilter) {
    setListFilter(filter);
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function runScan(mode: "reset" | "append") {
    if (mode === "reset") setScanning(true);
    else setAppending(true);
    setError("");
    setMessage("");

    const maxItems = mode === "reset" ? INITIAL_LOAD_MAX : APPEND_LOAD_MAX;
    const res = await fetch("/api/admin/outreach/scan", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, maxItems, pageSize: 100 }),
    });
    const json = await res.json().catch(() => ({}));
    setScanning(false);
    setAppending(false);

    if (!res.ok) {
      setError(json.error || "Ошибка загрузки из реестра");
      return;
    }

    const action = mode === "append" ? "Догружено" : "Загружено";
    const pending = json.enrichPending ?? 0;

    if (pending > 0) {
      setMessage(
        `${action}: ${json.loadedFromApi} записей. Email подгружаются на сервере в фоне — можно закрыть вкладку или перейти в другой раздел.`
      );
      await refresh(true);
      return;
    }

    setMessage(
      `${action}: ${json.loadedFromApi} из API · к отправке: ${json.eligible} · личные ящики: ${json.rejected}${json.hasMore ? " · в реестре ещё есть" : ""}`
    );
    await refresh();
  }

  async function saveSchedule(
    enabled: boolean,
    action: "enable" | "disable" | "limit" = enabled
      ? "enable"
      : "disable"
  ) {
    setSavingSchedule(true);
    setScheduleAction(action);
    setError("");
    setMessage("");

    const res = await fetch("/api/admin/outreach/schedule", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        emailsPerDay,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSavingSchedule(false);
      setScheduleAction(null);
      setError(json.error || "Не удалось сохранить настройки");
      return;
    }

    setEmailsPerDay(json.schedule?.emailsPerDay ?? emailsPerDay);
    setMessage(
      action === "limit"
        ? `Лимит сохранён: ${json.schedule?.emailsPerDay ?? emailsPerDay} писем в сутки`
        : enabled
          ? `Автоотправка включена — до ${json.schedule?.emailsPerDay ?? emailsPerDay} писем в сутки`
          : "Автоотправка выключена"
    );
    await refresh();
    setSavingSchedule(false);
    setScheduleAction(null);
  }

  async function sendBatch() {
    setSending(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/admin/outreach/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: sendCount }),
    });
    const json = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) {
      setError(json.error || "Ошибка отправки");
      return;
    }
    setMessage(`Отправлено писем: ${json.sent}`);
    await refresh();
  }

  async function toggleAutoExclude(id: number, exclude: boolean) {
    setTogglingId(id);
    setError("");
    const res = await fetch("/api/admin/outreach/exclude", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, exclude }),
    });
    const json = await res.json().catch(() => ({}));
    setTogglingId(null);
    if (!res.ok) {
      setError(json.error || "Не удалось обновить очередь");
      return;
    }
    await refresh();
  }

  async function sendOne(id: number, manual = false) {
    setSendingId(id);
    setError("");
    const res = await fetch("/api/admin/outreach/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], manual }),
    });
    const json = await res.json().catch(() => ({}));
    setSendingId(null);
    if (!res.ok || !json.results?.[0]?.ok) {
      const reason = json.results?.[0]?.reason as string | undefined;
      const reasonLabel =
        reason === "recipient_already_sent"
          ? "На этот email уже отправляли"
          : reason === "already_sent"
            ? "По этой декларации уже отправляли"
            : reason === "smtp_timeout"
              ? "Таймаут SMTP — сервер не отвечает"
              : reason === "smtp_auth_failed"
                ? "Ошибка авторизации SMTP (проверьте пароль приложения)"
                : reason === "smtp_send_failed"
                  ? "Ошибка отправки SMTP"
                  : reason === "smtp_not_configured"
                    ? "SMTP не настроен"
                    : reason;
      setError(json.error || reasonLabel || "Не удалось отправить");
      return;
    }
    setMessage(`Письмо отправлено (ID ${id})`);
    await refresh();
  }

  const autoSendableItems =
    data?.items.filter((item) => isAutoSendableRow(item)) ?? [];
  const sendableCount = data?.sendableCount ?? autoSendableItems.length;

  const filteredRows =
    listFilter === "eligible"
      ? (data?.items ?? [])
      : listFilter === "pending"
        ? autoSendableItems
        : listFilter === "rejected"
          ? (data?.rejected ?? [])
          : (data?.sent ?? []);

  const currentFilter = filterMeta[listFilter];
  const autoSendActive = Boolean(data?.schedule?.enabled);
  const enrichRunning = Boolean(data?.enrichStatus?.running);
  const enrichStopping = Boolean(data?.enrichStatus?.stopping);
  const enrichPaused = Boolean(data?.enrichStatus?.paused);
  const enrichPending = data?.enrichPending ?? 0;
  const enrichProcessed = data?.enrichStatus?.processedTotal ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Первая загрузка — до {INITIAL_LOAD_MAX} деклараций из API ФСА за один
          раз. Догрузка — по {APPEND_LOAD_MAX} за нажатие. Период: текущий и
          следующий месяц по дате окончания.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="btn-ghost gap-2 px-4 py-2 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
      </div>

      {(enrichRunning || enrichStopping || enrichPending > 0) && (
        <AdminCard
          className={
            enrichPaused && !enrichRunning && !enrichStopping
              ? "!border-amber-200 !bg-amber-50/80"
              : "!border-blue-200 !bg-blue-50/80"
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-blue-900">
            <div className="flex gap-3">
              {(enrichRunning || enrichStopping) && (
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              )}
              <p>
                {enrichStopping
                  ? "Останавливаем — завершаем текущий батч на сервере…"
                  : enrichRunning
                    ? "На сервере в фоне подгружаем email из карточек ФСА"
                    : enrichPaused
                      ? "Обогащение остановлено"
                      : "Остались карточки без email"}{" "}
                — обработано <strong>{enrichProcessed}</strong>, осталось{" "}
                <strong>{enrichPending}</strong>
                {enrichRunning && !enrichStopping
                  ? ". Можно уйти из раздела — процесс не остановится."
                  : enrichPaused
                    ? ". Нажмите «Продолжить», чтобы возобновить."
                    : "."}
              </p>
            </div>
            {enrichRunning || enrichStopping ? (
              <button
                type="button"
                onClick={() => void stopEnrich()}
                disabled={enrichStopping}
                className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {enrichStopping ? "Останавливаем…" : "Остановить"}
              </button>
            ) : enrichPending > 0 ? (
              <button
                type="button"
                onClick={() => void startBackgroundEnrich()}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Продолжить в фоне
              </button>
            ) : null}
          </div>
        </AdminCard>
      )}

      {data?.enrichStatus?.lastError && (
        <AdminCard className="!border-red-200 !bg-red-50/80">
          <p className="text-sm text-red-700">{data.enrichStatus.lastError}</p>
        </AdminCard>
      )}

      {data?.testMode && (
        <AdminCard className="!border-amber-200 !bg-amber-50/80">
          <div className="flex gap-3 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Тестовый режим: письма уходят на{" "}
              <strong>{data.testEmail}</strong>.
            </p>
          </div>
        </AdminCard>
      )}

      <AdminCard title="Заканчивающиеся" description="Фильтр: дата окончания действия">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-background p-4">
            <p className="text-xs text-muted">Период окончания</p>
            <p className="mt-1 font-semibold">
              {data ? `${data.range.from} — ${data.range.to}` : "—"}
            </p>
          </div>
          <StatFilterButton
            label="К отправке"
            count={data?.items.length ?? 0}
            active={listFilter === "eligible"}
            onClick={() => selectFilter("eligible")}
          />
          <StatFilterButton
            label="Готовы к отправке"
            count={sendableCount}
            active={listFilter === "pending"}
            onClick={() => selectFilter("pending")}
          />
          <StatFilterButton
            label="Личные ящики"
            count={data?.rejected.length ?? 0}
            active={listFilter === "rejected"}
            onClick={() => selectFilter("rejected")}
          />
          <StatFilterButton
            label="Всего отправлено"
            count={data?.sentCount ?? 0}
            active={listFilter === "sent"}
            onClick={() => selectFilter("sent")}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() => runScan("reset")}
            disabled={scanning || appending}
            className="btn-primary inline-flex gap-2 px-5 py-2.5 text-sm"
          >
            <Search className={`h-4 w-4 ${scanning ? "animate-pulse" : ""}`} />
            {scanning ? "Загрузка…" : `Загрузить из ФСА (до ${INITIAL_LOAD_MAX})`}
          </button>

          <button
            type="button"
            onClick={() => runScan("append")}
            disabled={scanning || appending || !data?.scannedAt}
            className="btn-ghost inline-flex gap-2 px-5 py-2.5 text-sm"
          >
            <ChevronDown className={`h-4 w-4 ${appending ? "animate-pulse" : ""}`} />
            {appending ? "Догрузка…" : `Догрузить следующие ${APPEND_LOAD_MAX}`}
          </button>

          <label className="text-sm">
            <span className="mb-1 block text-muted">Отправить первым</span>
            <input
              type="number"
              min={1}
              max={MAX_BATCH_SEND}
              value={sendCount}
              onChange={(e) => {
                const value = Number(e.target.value);
                const normalized = Number.isFinite(value) ? value : 1;
                setSendCount(Math.min(Math.max(normalized, 1), MAX_BATCH_SEND));
              }}
              className="input-field w-24"
            />
            <span className="mt-1 block text-xs text-muted">
              Максимум за запуск: {MAX_BATCH_SEND}
            </span>
          </label>

          <button
            type="button"
            onClick={sendBatch}
            disabled={sending || sendableCount === 0}
            className="btn-primary inline-flex gap-2 px-5 py-2.5 text-sm"
          >
            <Send className={`h-4 w-4 ${sending ? "animate-pulse" : ""}`} />
            {sending
              ? "Отправка…"
              : `Отправить пакетом (${Math.min(sendCount, sendableCount)} из ${sendableCount})`}
          </button>
        </div>

        {data?.scannedAt && (
          <p className="mt-3 text-xs text-muted">
            Список обновлён:{" "}
            {new Date(data.scannedAt).toLocaleString("ru-RU")}
            {data.hasMore
              ? ` · следующая страница API: ${data.nextApiPage + 1}`
              : " · в выбранном периоде больше нет страниц"}
            {data.enrichPending > 0
              ? ` · осталось обогатить: ${data.enrichPending}`
              : ""}
          </p>
        )}

        {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </AdminCard>

      <AdminCard title="Автоотправка">
        <div
          className={`mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${
            autoSendActive
              ? "border-green-200 bg-green-50"
              : "border-border bg-background"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full ${
                autoSendActive ? "bg-green-500 shadow-[0_0_0_4px_rgba(34,197,94,0.25)]" : "bg-gray-400"
              }`}
              aria-hidden
            />
            <div>
              <p
                className={`text-lg font-semibold ${
                  autoSendActive ? "text-green-900" : "text-primary"
                }`}
              >
                {autoSendActive ? "Автоотправка включена" : "Автоотправка выключена"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {autoSendActive
                  ? `Письма уходят автоматически в рабочее время ${data?.scheduleStats.workHoursLabel ?? "9:00–15:00 МСК"}`
                  : "Письма отправляются только вручную пакетом"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => saveSchedule(true, "enable")}
              disabled={savingSchedule || autoSendActive}
              className="btn-primary inline-flex gap-2 px-5 py-2.5 text-sm disabled:opacity-50"
            >
              <Power className="h-4 w-4" />
              {scheduleAction === "enable" ? "Включение…" : "Включить"}
            </button>
            <button
              type="button"
              onClick={() => saveSchedule(false, "disable")}
              disabled={savingSchedule || !autoSendActive}
              className="btn-ghost inline-flex gap-2 px-5 py-2.5 text-sm disabled:opacity-50"
            >
              <Power className="h-4 w-4" />
              {scheduleAction === "disable" ? "Выключение…" : "Выключить"}
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-background p-4">
            <p className="text-xs text-muted">Отправлено сегодня</p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {data?.scheduleStats.sentToday ?? 0}
              <span className="text-base font-medium text-muted">
                {" "}
                / {data?.schedule?.emailsPerDay ?? emailsPerDay}
              </span>
            </p>
          </div>
          <div className="rounded-xl bg-background p-4 sm:col-span-2">
            <p className="text-xs text-muted">Следующий запуск</p>
            <p className="mt-1 font-semibold">
              {autoSendActive
                ? data?.scheduleStats.nextRunLabel ?? "—"
                : "—"}
            </p>
            {autoSendActive && (
              <p className="mt-1 text-xs text-muted">
                {data?.scheduleStats.runsToday ?? 0} запусков сегодня ·{" "}
                {data?.scheduleStats.workHoursLabel ?? "9:00–15:00 МСК"}
              </p>
            )}
            {data?.schedule?.lastRunAt && (
              <p className="mt-1 text-xs text-muted">
                Последний автозапуск:{" "}
                {new Date(data.schedule.lastRunAt).toLocaleString("ru-RU")} ·
                отправлено {data.schedule.lastRunSent ?? 0}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-muted">Писем в сутки</span>
            <input
              type="number"
              min={1}
              max={MAX_DAILY_SEND}
              value={emailsPerDay}
              onChange={(e) => {
                const value = Number(e.target.value);
                const normalized = Number.isFinite(value) ? value : 1;
                setEmailsPerDay(
                  Math.min(Math.max(normalized, 1), MAX_DAILY_SEND)
                );
              }}
              className="input-field w-28"
            />
          </label>

          <button
            type="button"
            onClick={() => saveSchedule(autoSendActive, "limit")}
            disabled={savingSchedule}
            className="btn-primary inline-flex gap-2 px-5 py-2.5 text-sm"
          >
            {scheduleAction === "limit" ? "Сохранение…" : "Сохранить лимит"}
          </button>
        </div>

        <p className="mt-3 text-xs text-muted">
          Лимит применяется сразу. Чтобы изменить лимит при включённой
          автоотправке — нажмите «Сохранить лимит». Cron в ~6:00 МСК
          догружает список из ФСА; при нехватке адресов — дозагрузка перед
          автоотправкой.
          {data?.schedule?.lastFsaSyncAt && (
            <>
              {" "}
              Последняя синхронизация с ФСА:{" "}
              {new Date(data.schedule.lastFsaSyncAt).toLocaleString("ru-RU")}.
            </>
          )}
        </p>
      </AdminCard>

      <div ref={listRef}>
        <AdminCard
          title={currentFilter.label}
          description={`${currentFilter.description} · ${filteredRows.length} записей`}
        >
          {listFilter === "sent" ? (
            <SentTable rows={data?.sent ?? []} />
          ) : listFilter === "rejected" ? (
            <QueueTable
              rows={filteredRows as QueueItem[]}
              showRejectReason
              onSendOne={(id) => sendOne(id, true)}
              sendingId={sendingId}
              manualSend
            />
          ) : (
            <QueueTable
              rows={filteredRows as QueueItem[]}
              onSendOne={(id) => sendOne(id, false)}
              sendingId={sendingId}
              onToggleAutoExclude={toggleAutoExclude}
              togglingId={togglingId}
            />
          )}
        </AdminCard>
      </div>

      {!!data?.unsubscribed.length && (
        <AdminCard
          title="Отказались от писем"
          description="Нажали «Отписаться» в письме — этим адресам больше не отправляем"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Компания</th>
                </tr>
              </thead>
              <tbody>
                {data.unsubscribed.map((item) => (
                  <tr key={item.id} className="border-b border-border/70">
                    <td className="px-3 py-3 whitespace-nowrap">
                      {new Date(item.unsubscribedAt).toLocaleString("ru-RU")}
                    </td>
                    <td className="px-3 py-3">{item.email}</td>
                    <td className="px-3 py-3">{item.companyName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
    </div>
  );
}
