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
import type { OutreachCategory } from "@/lib/outreach/types";

type QueueItem = {
  id: number;
  number: string;
  registrationDate: string;
  endDate: string;
  productName: string;
  alreadySent: boolean;
  recipientAlreadySent: boolean;
  recipientCooldownUntil?: string | null;
  unsubscribed: boolean;
  sendable: boolean;
  autoSendable?: boolean;
  excludeFromAutoSend?: boolean;
  emailStatus?: "eligible" | "rejected" | "no_email";
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
  lastHourlyFsaAppendAt?: string | null;
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
  queued?: boolean;
  pending: number;
  processedTotal: number;
  emailsFoundTotal: number;
  sessionInitialPending: number | null;
  lastBatchAt: string | null;
  lastError: string | null;
  activeCategory?: string | null;
};

type FsaQueueStatus = {
  pendingHigh: number;
  pendingLow: number;
  running: boolean;
  runningType?: "scan" | "enrich" | "health" | null;
  runningSince?: string | null;
  enrichQueued?: boolean;
  enrichRunning?: boolean;
  scanQueued?: boolean;
  pendingScanAppend?: number;
  lastSummary: string | null;
  lastError: string | null;
};

type OutreachState = {
  categoryLabel: string;
  range: { from: string; to: string };
  scannedAt: string | null;
  nextApiPage: number;
  apiCursor?: { page: number; sortIndex: number; sliceIndex: number };
  cursorLabel?: string;
  pageSize: number;
  hasMore: boolean;
  enrichPending: number;
  enrichStatus: EnrichStatus;
  checkoBlock?: {
    active: boolean;
    remainingMs: number;
    reason: string | null;
  };
  fsaQueue?: FsaQueueStatus;
  dataChannel?: "fsa" | "ss_backup" | null;
  dataChannelLabel?: string | null;
  dataChannelRetryFsaAt?: string | null;
  testMode: boolean;
  testEmail: string | null;
  items: QueueItem[];
  rejected: QueueItem[];
  /** Счётчики с сервера (есть и в lite-ответе без списков) */
  itemsCount?: number;
  rejectedCount?: number;
  itemsTruncated?: boolean;
  rejectedTruncated?: boolean;
  sentTruncated?: boolean;
  listLimit?: number;
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
  // Rejected / no MX и т.п. — не «в очереди на отправку».
  if (item.emailStatus === "rejected" || item.emailStatus === "no_email") {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        {item.rejectLabel ?? "не для автоотправки"}
      </span>
    );
  }
  if (item.rejectLabel) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        {item.rejectLabel}
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
    const until = item.recipientCooldownUntil
      ? new Date(item.recipientCooldownUntil).toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "short",
        })
      : null;
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        {until ? `повтор с ${until}` : "пауза на этот email"}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">
      готов к отправке
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
  variant = "fsa",
}: {
  rows: QueueItem[];
  showRejectReason?: boolean;
  onSendOne?: (id: number) => void;
  sendingId?: number | null;
  manualSend?: boolean;
  onToggleAutoExclude?: (id: number, exclude: boolean) => void;
  togglingId?: number | null;
  variant?: "fsa" | "checko";
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Список пуст</p>;
  }

  const isChecko = variant === "checko";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted">
            <th className="px-3 py-2 font-medium">Компания</th>
            <th className="px-3 py-2 font-medium">
              {isChecko ? "Дата регистрации" : "Регистрация"}
            </th>
            {!isChecko && (
              <th className="px-3 py-2 font-medium">Окончание</th>
            )}
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">
              {isChecko ? "ОКВЭД / деятельность" : "Продукция"}
            </th>
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
              {!isChecko && (
                <td className="px-3 py-3 whitespace-nowrap">{item.endDate}</td>
              )}
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
                      item.alreadySent ||
                      item.unsubscribed ||
                      (manualSend
                        ? !item.applicant?.email
                        : !item.sendable)
                    }
                    onClick={() => onSendOne(item.id)}
                    className="btn-ghost gap-1 px-2 py-1 text-xs disabled:opacity-40"
                    title={
                      item.alreadySent
                        ? "Уже отправлено"
                        : !manualSend && !item.sendable
                          ? item.blockLabel
                          : undefined
                    }
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendingId === item.id
                      ? "…"
                      : item.alreadySent
                        ? "Отправлено"
                        : "Отправить"}
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

function FsaLoadConfirmDialog({
  open,
  isFirstLoad,
  queueSize,
  onCancel,
  onConfirm,
  docWordNominative,
  docWordGenitive,
  source = "fsa",
}: {
  open: boolean;
  isFirstLoad: boolean;
  queueSize: number;
  onCancel: () => void;
  onConfirm: () => void;
  docWordNominative: string;
  docWordGenitive: string;
  source?: "fsa" | "checko";
}) {
  if (!open) return null;

  const isChecko = source === "checko";
  const sourceLabel = isChecko ? "checko.ru" : "ФСА";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fsa-load-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-primary-dark/45 backdrop-blur-[2px]"
        aria-label="Закрыть"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-2xl">
        <div className="flex gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Search className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3
              id="fsa-load-title"
              className="text-lg font-bold text-primary-dark"
            >
              {isFirstLoad
                ? `Загрузить ${docWordNominative} с ${sourceLabel}?`
                : `Догрузить ${docWordNominative} с ${sourceLabel}?`}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {isChecko ? (
                isFirstLoad ? (
                  <>
                    Срочно найдём до <strong>{INITIAL_LOAD_MAX}</strong>{" "}
                    {docWordGenitive}, зарегистрированных{" "}
                    <strong>за последние 21 день</strong>, в списке checko.ru.
                    Email подтянем в фоне — по одной карточке, с паузами.
                  </>
                ) : (
                  <>
                    Добавим до <strong>{INITIAL_LOAD_MAX}</strong> новых{" "}
                    {docWordGenitive} с checko.ru поверх очереди (
                    <strong>{queueSize}</strong> в базе). Уже загруженные
                    компании и история отправок <strong>сохранятся</strong>.
                    Email без срочности — в фоне.
                  </>
                )
              ) : isFirstLoad ? (
                <>
                  Запросим до <strong>{INITIAL_LOAD_MAX}</strong>{" "}
                  {docWordGenitive} с
                  истекающим сроком из реестра ФСА. Загрузка может занять
                  несколько минут — не закрывайте вкладку до завершения.
                </>
              ) : (
                <>
                  Добавим до <strong>{INITIAL_LOAD_MAX}</strong> новых{" "}
                  {docWordGenitive} поверх текущей очереди (
                  <strong>{queueSize}</strong> в базе). Уже загруженные
                  компании, история отправок и отказы от рассылки{" "}
                  <strong>сохранятся</strong>. Реестр обходится с другой
                  сортировки — появятся новые компании, которых ещё не было.
                </>
              )}
            </p>
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              {isChecko
                ? "Важная операция: срочный обход списка checko.ru. Карточки с email — отдельно, медленно. Запускайте, когда готовы."
                : "Это важная операция: идёт обращение к внешнему API ФСА и фоновое обогащение email. Нажимайте только когда готовы начать загрузку."}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost px-5 py-2.5 text-sm"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-primary px-5 py-2.5 text-sm"
          >
            {isFirstLoad
              ? "Начать загрузку"
              : isChecko
                ? "Догрузить с checko.ru"
                : "Догрузить из ФСА"}
          </button>
        </div>
      </div>
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

export function OutreachPanel({
  category,
  active = true,
}: {
  category: OutreachCategory;
  /** false = вкладка скрыта, но панель жива — не поллим и не сбрасываем данные */
  active?: boolean;
}) {
  const docWord =
    category === "expiring_certificates"
      ? "сертификаты"
      : category === "new_registrations"
        ? "организации"
        : "декларации";
  const docWordGenitive =
    category === "expiring_certificates"
      ? "сертификатов"
      : category === "new_registrations"
        ? "организаций"
        : "деклараций";
  const docAccusative =
    category === "expiring_certificates"
      ? "сертификат"
      : category === "new_registrations"
        ? "организацию"
        : "декларацию";
  const docThisLabel =
    category === "expiring_certificates"
      ? "этому сертификату"
      : category === "new_registrations"
        ? "этой организации"
        : "этой декларации";
  const isChecko = category === "new_registrations";
  const sourceLabel = isChecko ? "checko.ru" : "ФСА";
  const tableVariant = isChecko ? "checko" : "fsa";
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
  const [enrichStarting, setEnrichStarting] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>("pending");
  const [showLoadConfirm, setShowLoadConfirm] = useState(false);
  const [checkingFsaAccess, setCheckingFsaAccess] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedOnce = useRef(false);
  const lastFullRefreshAt = useRef(0);
  const listSignature = useRef("");
  /** Пока запрос в полёте — не плодим одинаковые /api/admin/outreach. */
  const fullRefreshInFlight = useRef<Promise<void> | null>(null);
  const statusRefreshInFlight = useRef<Promise<void> | null>(null);
  /** Для интервала lite-poll без перезапуска эффекта на каждый тик. */
  const pollBusyRef = useRef(false);

  function applyScheduleFrom(json: OutreachState) {
    if (json.schedule) {
      setEmailsPerDay(json.schedule.emailsPerDay ?? 50);
    }
  }

  /** Сразу отражаем ответ POST enrich/stop в UI — не ждём следующего poll. */
  function applyEnrichApiPayload(json: Record<string, unknown>) {
    const fsaQueue = json.fsaQueue as FsaQueueStatus | undefined;
    const pending =
      typeof json.pending === "number" ? json.pending : undefined;
    setData((prev) => {
      if (!prev) return prev;
      const nextStatus: EnrichStatus = {
        ...prev.enrichStatus,
        running: Boolean(json.running ?? prev.enrichStatus.running),
        stopping: Boolean(json.stopping ?? prev.enrichStatus.stopping),
        paused: Boolean(json.paused ?? prev.enrichStatus.paused),
        queued: Boolean(
          json.queued ??
            fsaQueue?.enrichQueued ??
            prev.enrichStatus.queued
        ),
        pending: pending ?? prev.enrichStatus.pending,
        processedTotal:
          typeof json.processedTotal === "number"
            ? json.processedTotal
            : prev.enrichStatus.processedTotal,
        emailsFoundTotal:
          typeof json.emailsFoundTotal === "number"
            ? json.emailsFoundTotal
            : prev.enrichStatus.emailsFoundTotal,
        sessionInitialPending:
          json.sessionInitialPending !== undefined
            ? (json.sessionInitialPending as number | null)
            : prev.enrichStatus.sessionInitialPending,
        lastBatchAt:
          (json.lastBatchAt as string | null | undefined) !== undefined
            ? (json.lastBatchAt as string | null)
            : prev.enrichStatus.lastBatchAt,
        lastError:
          (json.lastError as string | null | undefined) !== undefined
            ? (json.lastError as string | null)
            : prev.enrichStatus.lastError,
        activeCategory:
          (json.activeCategory as string | null | undefined) !== undefined
            ? (json.activeCategory as string | null)
            : prev.enrichStatus.activeCategory,
      };
      // Если задача принята в очередь — сразу убираем «Продолжить», не ждём poll.
      if (json.ok && (json.queued || json.duplicate)) {
        nextStatus.paused = false;
        nextStatus.queued = true;
        if (json.running || fsaQueue?.enrichRunning) {
          nextStatus.running = true;
        }
      }
      return {
        ...prev,
        enrichPending: pending ?? prev.enrichPending,
        enrichStatus: nextStatus,
        fsaQueue: fsaQueue ?? prev.fsaQueue,
      };
    });
  }

  /** Полная загрузка списков — только старт / Обновить / после действий. */
  async function refresh(silent = false, opts?: { loadAll?: boolean }) {
    if (fullRefreshInFlight.current) {
      // Silent-poll: ждём текущий запрос и выходим (без дублей).
      // После мутаций (silent=false) после ожидания грузим ещё раз —
      // иначе можно «приклеиться» к ответу, начатому до изменения.
      await fullRefreshInFlight.current;
      if (silent) return;
    }

    const run = (async () => {
      if (!silent) setLoading(true);
      if (!silent) setError("");
      try {
        // Первая отрисовка вкладки: лёгкий статус сразу, списки — следом.
        if (!silent && !loadedOnce.current) {
          try {
            const liteRes = await fetch(
              `/api/admin/outreach?category=${encodeURIComponent(category)}&lite=1`,
              { credentials: "same-origin" }
            );
            if (liteRes.ok) {
              const liteJson = (await liteRes.json()) as OutreachState;
              setData({
                ...liteJson,
                items: [],
                rejected: [],
                sent: [],
                recentSent: [],
                unsubscribed: [],
              });
              applyScheduleFrom(liteJson);
              loadedOnce.current = true;
              setLoading(false);
            }
          } catch {
            // полный запрос ниже
          }
        }

        const qs = new URLSearchParams({
          category,
        });
        if (opts?.loadAll) {
          qs.set("limit", "0");
          qs.set("sentLimit", "0");
        }
        const res = await fetch(
          `/api/admin/outreach?${qs.toString()}`,
          { credentials: "same-origin" }
        );
        if (!res.ok) {
          if (!silent) setError("Не удалось загрузить данные рассылки");
          return;
        }
        const json = (await res.json()) as OutreachState;
        setData(json);
        loadedOnce.current = true;
        lastFullRefreshAt.current = Date.now();
        listSignature.current = [
          json.itemsCount ?? json.items?.length ?? 0,
          json.rejectedCount ?? json.rejected?.length ?? 0,
          json.sentCount ?? 0,
          json.enrichStatus?.emailsFoundTotal ?? 0,
          json.enrichStatus?.processedTotal ?? 0,
        ].join(":");
        applyScheduleFrom(json);
      } finally {
        if (!silent) setLoading(false);
      }
    })();

    fullRefreshInFlight.current = run.finally(() => {
      if (fullRefreshInFlight.current === run) {
        fullRefreshInFlight.current = null;
      }
    });
    await fullRefreshInFlight.current;
  }

  /** Лёгкий poll: статус + счётчики, без МБ списков. */
  async function refreshStatus(opts?: {
    force?: boolean;
  }): Promise<OutreachState | null> {
    if (!loadedOnce.current) return null;
    if (fullRefreshInFlight.current) {
      await fullRefreshInFlight.current;
      if (!opts?.force) return null;
    }
    if (statusRefreshInFlight.current) {
      await statusRefreshInFlight.current;
      if (!opts?.force) return null;
    }

    let latest: OutreachState | null = null;
    const run = (async () => {
      const res = await fetch(
        `/api/admin/outreach?category=${encodeURIComponent(category)}&lite=1`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return;
      const json = (await res.json()) as OutreachState;
      latest = json;
      const nextSig = [
        json.itemsCount ?? 0,
        json.rejectedCount ?? 0,
        json.sentCount ?? 0,
        json.enrichStatus?.emailsFoundTotal ?? 0,
        json.enrichStatus?.processedTotal ?? 0,
      ].join(":");

      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          scannedAt: json.scannedAt,
          nextApiPage: json.nextApiPage,
          apiCursor: json.apiCursor,
          cursorLabel: json.cursorLabel,
          hasMore: json.hasMore,
          enrichPending: json.enrichPending,
          enrichStatus: json.enrichStatus,
          checkoBlock: json.checkoBlock,
          fsaQueue: json.fsaQueue,
          itemsCount: json.itemsCount,
          rejectedCount: json.rejectedCount,
          sendableCount: json.sendableCount,
          sentCount: json.sentCount,
          schedule: json.schedule,
          scheduleStats: json.scheduleStats,
          testMode: json.testMode,
          testEmail: json.testEmail,
          range: json.range,
        };
      });
      applyScheduleFrom(json);

      // Список устарел — один полный silent refresh, не чаще раза в 45 с.
      if (
        nextSig !== listSignature.current &&
        Date.now() - lastFullRefreshAt.current > 45_000
      ) {
        listSignature.current = nextSig;
        void refresh(true);
      }
    })();

    statusRefreshInFlight.current = run.finally(() => {
      if (statusRefreshInFlight.current === run) {
        statusRefreshInFlight.current = null;
      }
    });
    await statusRefreshInFlight.current;
    return latest;
  }

  useEffect(() => {
    if (loadedOnce.current) return;
    setLoading(true);
    setError("");
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Вернулись на вкладку — только статус, без повторной выгрузки МБ
  useEffect(() => {
    if (!active || !loadedOnce.current) return;
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // lite-poll всегда, пока вкладка открыта (счётчики + кнопки).
  // Интервал короче при активной FSA/enrich; эффект НЕ перезапускаем на каждый тик.
  useEffect(() => {
    pollBusyRef.current =
      Boolean(data?.enrichStatus?.running) ||
      Boolean(data?.enrichStatus?.stopping) ||
      Boolean(data?.enrichStatus?.queued) ||
      (data?.enrichPending ?? 0) > 0 ||
      Boolean(data?.fsaQueue?.running) ||
      (data?.fsaQueue?.pendingHigh ?? 0) + (data?.fsaQueue?.pendingLow ?? 0) > 0;
  }, [
    data?.enrichStatus?.running,
    data?.enrichStatus?.stopping,
    data?.enrichStatus?.queued,
    data?.enrichPending,
    data?.fsaQueue?.running,
    data?.fsaQueue?.pendingHigh,
    data?.fsaQueue?.pendingLow,
  ]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (loadedOnce.current) {
        await refreshStatus();
      }
      if (cancelled) return;
      const delay = pollBusyRef.current ? 4_000 : 10_000;
      timer = setTimeout(() => {
        void tick();
      }, delay);
    };

    // Первый тик быстро — чтобы кнопки/статус не «висели» после действий.
    timer = setTimeout(() => {
      void tick();
    }, 1_500);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, category]);

  async function startBackgroundEnrich(resetCounters = false) {
    setError("");
    setMessage("");
    setEnrichStarting(true);
    // Оптимистично: сразу «в очереди», иначе до ответа API остаётся «Продолжить».
    setData((prev) =>
      prev
        ? {
            ...prev,
            enrichStatus: {
              ...prev.enrichStatus,
              paused: false,
              queued: true,
              stopping: false,
            },
          }
        : prev
    );
    try {
      const res = await fetch(
        `/api/admin/outreach/enrich?category=${encodeURIComponent(category)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true, resetCounters }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        setError(
          (json.error as string) || "Не удалось запустить фоновое обогащение"
        );
        await refreshStatus();
        return;
      }
      applyEnrichApiPayload(json);
      if (json.queued || json.duplicate) {
        setMessage(
          (json.message as string) ||
            (json.duplicate
              ? "Обработка email уже в очереди — ждём следующий запуск."
              : "Обработка email поставлена в очередь.")
        );
      } else if (json.message && json.ok) {
        setMessage(String(json.message));
      } else if (json.lastError) {
        setError(String(json.lastError));
      }
      // Lite сразу; полный список — без silent-склейки со старым запросом.
      await refreshStatus();
      void refresh();
    } finally {
      setEnrichStarting(false);
    }
  }

  async function stopEnrich() {
    setMessage("Убираем из очереди…");
    setData((prev) =>
      prev
        ? {
            ...prev,
            enrichStatus: {
              ...prev.enrichStatus,
              stopping: prev.enrichStatus.running,
              queued: false,
              paused: true,
              running: false,
            },
          }
        : prev
    );
    const res = await fetch(
      `/api/admin/outreach/enrich?category=${encodeURIComponent(
        category
      )}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      }
    );
    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    applyEnrichApiPayload({ ...json, queued: false, paused: true });
    setMessage("Обработка email снята с очереди.");
    await refreshStatus();
    void refresh();
  }

  async function cancelFsaQueue(scope: "all" | "scan" | "enrich" = "all") {
    setError("");
    setMessage("");
    const res = await fetch(
      `/api/admin/outreach/fsa/cancel?category=${encodeURIComponent(category)}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, category }),
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Не удалось снять задачи с очереди");
      return;
    }
    setMessage(json.message || "Снято с очереди");
    if (json.fsaQueue) {
      setData((prev) =>
        prev
          ? {
              ...prev,
              fsaQueue: json.fsaQueue,
              enrichStatus: {
                ...prev.enrichStatus,
                queued: Boolean(json.fsaQueue?.enrichQueued),
                running:
                  prev.enrichStatus.running ||
                  Boolean(json.fsaQueue?.enrichRunning),
              },
            }
          : prev
      );
    }
    await refreshStatus();
    void refresh();
  }

  function selectFilter(filter: ListFilter) {
    setListFilter(filter);
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function runScan(
    mode: "reset" | "append",
    maxItemsOverride?: number
  ) {
    if (mode === "reset") setScanning(true);
    else setAppending(true);
    setError("");
    setMessage("");

    try {
      const maxItems =
        maxItemsOverride ??
        (mode === "reset" ? INITIAL_LOAD_MAX : APPEND_LOAD_MAX);
      const res = await fetch(
        `/api/admin/outreach/scan?category=${encodeURIComponent(category)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, maxItems, pageSize: 100, category }),
        }
      );
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const fsaQueue = json.fsaQueue as FsaQueueStatus | undefined;
        if (fsaQueue) {
          setData((prev) => (prev ? { ...prev, fsaQueue } : prev));
        }
        setMessage("");
        setError(json.error || "Ошибка загрузки из реестра");
        await refreshStatus({ force: true }).catch(() => null);
        return;
      }

      if (json.queued) {
        const amount =
          maxItemsOverride ??
          (mode === "reset" ? INITIAL_LOAD_MAX : APPEND_LOAD_MAX);
        const pending =
          typeof json.pendingAppendScans === "number"
            ? json.pendingAppendScans
            : null;
        // Не обещаем «данные обновятся» — только что задача принята.
        setMessage(
          json.duplicate
            ? String(json.message || "Задача уже выполняется.")
            : mode === "append" && pending != null
              ? `Принято: +${amount} (в очереди догрузок: ${pending}).`
              : `Принято: загрузка до ${amount} записей.`
        );
        const fsaQueue = json.fsaQueue as FsaQueueStatus | undefined;
        // Только серверный статус — без фейка «running + срочных 0».
        if (fsaQueue) {
          setData((prev) => (prev ? { ...prev, fsaQueue } : prev));
        }

        // Ждём конец задачи по серверному статусу (не по локальному scanning).
        const deadline = Date.now() + 170_000;
        let nullPolls = 0;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await refreshStatus({ force: true });
          const fq = status?.fsaQueue;
          if (!fq) {
            nullPolls += 1;
            if (nullPolls >= 3) break;
            continue;
          }
          nullPolls = 0;
          const busy =
            Boolean(fq.running) ||
            (fq.pendingHigh ?? 0) > 0 ||
            (fq.pendingScanAppend ?? 0) > 0;
          if (!busy) {
            if (fq.lastError) {
              setMessage("");
              setError(fq.lastError);
            } else if (fq.lastSummary) {
              setError("");
              setMessage(fq.lastSummary);
            } else {
              setMessage("");
            }
            break;
          }
        }
        await refresh(true);
        return;
      }

      setMessage(json.message || "Запрос принят, ожидаем обновление очереди.");
      await refreshStatus();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isChecko
            ? "Сеть оборвалась во время загрузки с checko.ru"
            : "Сеть оборвалась во время загрузки из ФСА"
      );
    } finally {
      setScanning(false);
      setAppending(false);
    }
  }

  function requestFsaLoad() {
    if (scanning || appending) return;
    setShowLoadConfirm(true);
  }

  function requestAppendLoad() {
    if (scanning || appending) return;
    // Пустая очередь: первая догрузка = reset на 100, не disabled
    if (!data?.scannedAt) {
      void runScan("reset", APPEND_LOAD_MAX);
      return;
    }
    void runScan("append");
  }

  function confirmFsaLoad() {
    setShowLoadConfirm(false);
    const mode = data?.scannedAt ? "append" : "reset";
    void runScan(mode, INITIAL_LOAD_MAX);
  }

  async function checkFsaAccess() {
    setCheckingFsaAccess(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `/api/admin/outreach/fsa/health?category=${encodeURIComponent(category)}`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Не удалось проверить доступ");
        return;
      }
      if (json.ok) {
        setMessage(json.message || "Доступ к ФСА подтверждён.");
      } else {
        setError(json.message || json.error || "Нет доступа к ФСА");
      }
    } finally {
      setCheckingFsaAccess(false);
    }
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

    const res = await fetch(
      `/api/admin/outreach/schedule?category=${encodeURIComponent(
        category
      )}`,
      {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        emailsPerDay,
      }),
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSavingSchedule(false);
      setScheduleAction(null);
      setError(json.error || "Не удалось сохранить настройки");
      return;
    }

    setEmailsPerDay(json.schedule?.emailsPerDay ?? emailsPerDay);
    if (json.schedule) {
      setData((prev) =>
        prev ? { ...prev, schedule: json.schedule } : prev
      );
    }
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
    const res = await fetch(
      `/api/admin/outreach/send?category=${encodeURIComponent(category)}`,
      {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: sendCount, category }),
      }
    );
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
    const res = await fetch(
      `/api/admin/outreach/exclude?category=${encodeURIComponent(category)}`,
      {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, exclude, category }),
      }
    );
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
    const res = await fetch(
      `/api/admin/outreach/send?category=${encodeURIComponent(category)}`,
      {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], manual, category }),
      }
    );
    const json = await res.json().catch(() => ({}));
    setSendingId(null);
    if (!res.ok || !json.results?.[0]?.ok) {
      const reason = json.results?.[0]?.reason as string | undefined;
      const reasonLabel =
        reason === "recipient_already_sent"
          ? `На этот email недавно уже писали — подождите неделю или выберите другую ${docAccusative}`
          : reason === "already_sent"
            ? `По ${docThisLabel} уже отправляли`
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
    // Сразу в UI — не ждём полный refresh (иначе «Отправить» висит).
    setData((prev) => {
      if (!prev) return prev;
      const mark = (rows: QueueItem[]) =>
        rows.map((row) =>
          row.id === id
            ? {
                ...row,
                alreadySent: true,
                sendable: false,
                autoSendable: false,
                blockReason: "already_sent",
                blockLabel: "уже отправляли",
              }
            : row
        );
      return {
        ...prev,
        items: mark(prev.items),
        rejected: mark(prev.rejected),
        sendableCount: Math.max((prev.sendableCount ?? 1) - 1, 0),
        sentCount: (prev.sentCount ?? 0) + 1,
      };
    });
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
  const enrichQueued =
    Boolean(data?.enrichStatus?.queued) ||
    Boolean(data?.fsaQueue?.enrichQueued) ||
    enrichStarting;
  const enrichPaused =
    Boolean(data?.enrichStatus?.paused) && !enrichQueued && !enrichRunning;
  const enrichPending = data?.enrichPending ?? 0;
  const checkoBlocked = Boolean(data?.checkoBlock?.active);
  const checkoBlockMins = Math.max(
    1,
    Math.ceil((data?.checkoBlock?.remainingMs ?? 0) / 60_000)
  );
  const enrichProcessed = data?.enrichStatus?.processedTotal ?? 0;
  const enrichEmailsFound = data?.enrichStatus?.emailsFoundTotal ?? 0;
  const enrichSessionTotal = data?.enrichStatus?.sessionInitialPending ?? null;
  const enrichProgressLabel =
    enrichSessionTotal != null && enrichSessionTotal > 0
      ? `обработано ${enrichProcessed} из ${enrichSessionTotal}`
      : `обработано ${enrichProcessed}`;

  const fsaPendingHigh = data?.fsaQueue?.pendingHigh ?? 0;
  const fsaPendingLow = data?.fsaQueue?.pendingLow ?? 0;
  const fsaQueuePending = fsaPendingHigh + fsaPendingLow;
  /** Реальная работа на сервере — не путать с локальным scanning. */
  const fsaServerBusy = Boolean(data?.fsaQueue?.running);
  const fsaQueuedWaiting = fsaQueuePending > 0 && !fsaServerBusy;
  // Синяя плашка обогащения уже показывает ту же фоновую задачу — не дублируем.
  // Срочные догрузки (+100) всегда показываем в полоске очереди.
  const onlyEnrichInFsaQueue =
    enrichQueued &&
    fsaPendingHigh === 0 &&
    fsaPendingLow > 0 &&
    !data?.fsaQueue?.scanQueued &&
    (data?.fsaQueue?.pendingScanAppend ?? 0) === 0;
  const showFsaQueueStrip =
    Boolean(data?.fsaQueue) &&
    !onlyEnrichInFsaQueue &&
    (fsaServerBusy ||
      fsaQueuedWaiting ||
      scanning ||
      appending ||
      Boolean(data?.fsaQueue?.lastSummary) ||
      Boolean(data?.fsaQueue?.lastError));

  const queueSize =
    (data?.itemsCount ?? data?.items.length ?? 0) +
    (data?.rejectedCount ?? data?.rejected.length ?? 0) +
    (data?.enrichPending ?? 0);

  return (
    <div className="space-y-4">
      <FsaLoadConfirmDialog
        open={showLoadConfirm}
        isFirstLoad={!data?.scannedAt}
        queueSize={queueSize}
        onCancel={() => setShowLoadConfirm(false)}
        onConfirm={confirmFsaLoad}
        docWordNominative={docWord}
        docWordGenitive={docWordGenitive}
        source={isChecko ? "checko" : "fsa"}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {isChecko
            ? "Срочно — список с checko.ru. Email с карточек — в фоне, по одной, с паузами."
            : "Срочная загрузка из ФСА идёт раньше фоновой подгрузки email."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="btn-ghost gap-2 px-4 py-2 text-sm"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </button>
          {!isChecko && (
            <button
              type="button"
              onClick={checkFsaAccess}
              disabled={checkingFsaAccess}
              className="btn-ghost gap-2 px-4 py-2 text-sm"
            >
              <AlertCircle className={`h-4 w-4 ${checkingFsaAccess ? "animate-pulse" : ""}`} />
              {checkingFsaAccess ? "Проверка..." : "Проверить доступ к ФСА"}
            </button>
          )}
        </div>
      </div>

      {(enrichRunning ||
        enrichStopping ||
        enrichQueued ||
        enrichPaused ||
        enrichPending > 0) && (
        <AdminCard
          className={
            enrichPaused && !enrichRunning && !enrichStopping && !enrichQueued
              ? "!border-amber-200 !bg-amber-50/80"
              : "!border-blue-200 !bg-blue-50/80"
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-blue-900">
            <div className="flex gap-3">
              {(enrichRunning || enrichStopping || enrichQueued) && (
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              )}
              <p>
                {enrichStopping
                  ? "Останавливаем — завершаем текущий батч на сервере…"
                  : enrichRunning
                    ? isChecko
                      ? "В фоне берём email с карточек checko.ru (по одной, с паузами)"
                      : "На сервере в фоне подгружаем email из карточек ФСА"
                    : enrichQueued
                      ? "Обработка email в очереди"
                      : checkoBlocked
                        ? `Пауза checko ~${checkoBlockMins} мин (защита сайта) — потом продолжит сам`
                      : enrichPaused
                        ? "Обогащение остановлено"
                        : "Остались карточки без email"}{" "}
                — {enrichProgressLabel}, найдено email{" "}
                <strong>{enrichEmailsFound}</strong>, в очереди{" "}
                <strong>{enrichPending}</strong>
                {enrichRunning && !enrichStopping
                  ? ". Можно уйти из раздела — процесс не остановится."
                  : enrichQueued && fsaPendingHigh > 0
                    ? `. Сейчас сначала идут срочные загрузки (${fsaPendingHigh}), email начнётся следом.`
                    : enrichQueued
                    ? "."
                    : checkoBlocked
                      ? ". Не жмите «Продолжить» сразу — так только продлите блок."
                    : enrichPaused
                      ? ". Нажмите «Продолжить», чтобы возобновить."
                      : enrichPending > 0
                        ? isChecko
                          ? ". Если счётчик не растёт без паузы — нажмите «Продолжить в фоне»."
                          : ". Если счётчик не растёт — проверьте доступ к ФСА."
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
            ) : enrichQueued ? (
              <button
                type="button"
                onClick={() => void stopEnrich()}
                disabled={enrichStarting}
                className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {enrichStarting ? "Запускаем…" : "Убрать из очереди"}
              </button>
            ) : enrichPending > 0 ? (
              <button
                type="button"
                onClick={() => void startBackgroundEnrich()}
                disabled={enrichStarting || checkoBlocked}
                className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                title={
                  checkoBlocked
                    ? `Подождите ~${checkoBlockMins} мин`
                    : undefined
                }
              >
                {enrichStarting
                  ? "Запускаем…"
                  : checkoBlocked
                    ? `Пауза ~${checkoBlockMins} мин`
                    : "Продолжить в фоне"}
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

      <AdminCard
        title={
          isChecko
            ? "Новые организации"
            : `Заканчивающиеся ${docWord}`
        }
        description={
          isChecko
            ? "Фильтр: дата регистрации на checko.ru (последние 21 день, только ЮЛ)"
            : "Фильтр: дата окончания действия"
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-background p-4">
            <p className="text-xs text-muted">
              {isChecko ? "Период регистрации" : "Период окончания"}
            </p>
            <p className="mt-1 font-semibold">
              {data ? `${data.range.from} — ${data.range.to}` : "—"}
            </p>
          </div>
          <StatFilterButton
            label="К отправке"
            count={data?.itemsCount ?? data?.items.length ?? 0}
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
            count={data?.rejectedCount ?? data?.rejected.length ?? 0}
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
            onClick={requestFsaLoad}
            disabled={scanning || appending}
            className="btn-primary inline-flex gap-2 px-5 py-2.5 text-sm"
          >
            <Search className={`h-4 w-4 ${scanning || appending ? "animate-pulse" : ""}`} />
            {scanning || appending
              ? "Загрузка…"
              : data?.scannedAt && (data?.fsaQueue?.pendingScanAppend ?? 0) > 0
                ? `Загрузить ещё до ${INITIAL_LOAD_MAX} (в очереди ${data.fsaQueue?.pendingScanAppend})`
                : `Загрузить с ${sourceLabel} (до ${INITIAL_LOAD_MAX})`}
          </button>

          <button
            type="button"
            onClick={requestAppendLoad}
            disabled={scanning || appending}
            className="btn-ghost inline-flex gap-2 px-5 py-2.5 text-sm"
          >
            <ChevronDown className={`h-4 w-4 ${appending ? "animate-pulse" : ""}`} />
            {appending
              ? "Догрузка…"
              : (data?.fsaQueue?.pendingScanAppend ?? 0) > 0
                ? `Догрузить ещё ${APPEND_LOAD_MAX} (в очереди ${data?.fsaQueue?.pendingScanAppend})`
                : `Догрузить следующие ${APPEND_LOAD_MAX}`}
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
              ? ` · следующая загрузка: ${data.cursorLabel ?? `стр. ${data.nextApiPage + 1}`}`
              : " · в выбранном периоде больше нет данных"}
            {data.enrichPending > 0
              ? ` · осталось обогатить: ${data.enrichPending}`
              : ""}
            {category === "expiring_certificates" && data.dataChannelLabel
              ? ` · канал: ${data.dataChannelLabel}`
              : ""}
            {category === "expiring_certificates" &&
            data.dataChannel === "ss_backup" &&
            data.dataChannelRetryFsaAt
              ? ` · повтор ФСА после ${new Date(
                  data.dataChannelRetryFsaAt
                ).toLocaleString("ru-RU")}`
              : ""}
          </p>
        )}

        {showFsaQueueStrip && data?.fsaQueue && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <p>
              {fsaServerBusy
                ? data.fsaQueue.runningType === "enrich"
                  ? "Сейчас идёт обогащение email…"
                  : `Сейчас загружаем данные с ${sourceLabel}…`
                : scanning || appending
                  ? "Запускаем задачу…"
                  : fsaQueuePending > 0
                    ? `В очереди задач: срочных ${data.fsaQueue.pendingHigh}, фоновых ${data.fsaQueue.pendingLow}.`
                    : "Очередь задач пуста."}
              {data.fsaQueue.lastSummary
                ? ` Последний результат: ${data.fsaQueue.lastSummary}.`
                : ""}
              {data.fsaQueue.lastError
                ? ` Последняя ошибка: ${data.fsaQueue.lastError}.`
                : ""}
            </p>
            {fsaQueuePending > 0 && (
              <button
                type="button"
                onClick={() => void cancelFsaQueue("all")}
                className="btn-ghost px-2 py-1 text-xs"
              >
                Очистить очередь
              </button>
            )}
          </div>
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
          {isChecko ? (
            <>
              Лимит применяется сразу. Cron каждые ~20 мин: при нехватке адресов
              догружает список новых организаций с checko.ru (21 день), email —
              в фоне по одной карточке.
            </>
          ) : (
            <>
              Лимит применяется сразу. Cron каждые ~20 мин: раз в час догружает
              до 100 {docWordGenitive} из ФСА (поверх очереди); в ~6:00 МСК —
              утренняя синхронизация; при нехватке адресов — дозагрузка перед
              автоотправкой.
            </>
          )}
          {!isChecko && data?.schedule?.lastHourlyFsaAppendAt && (
            <>
              {" "}
              Последняя почасовая догрузка:{" "}
              {new Date(data.schedule.lastHourlyFsaAppendAt).toLocaleString(
                "ru-RU"
              )}
              .
            </>
          )}
          {!isChecko && data?.schedule?.lastFsaSyncAt && (
            <>
              {" "}
              Утренняя синхронизация:{" "}
              {new Date(data.schedule.lastFsaSyncAt).toLocaleString("ru-RU")}.
            </>
          )}
        </p>
      </AdminCard>

      <div ref={listRef}>
        {(data?.itemsTruncated ||
          data?.rejectedTruncated ||
          data?.sentTruncated) && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p>
              Показана укороченная выборка (до {data.listLimit ?? 300} в
              списках), чтобы страница не зависала. Счётчики сверху — полные.
            </p>
            <button
              type="button"
              className="btn-ghost shrink-0 px-3 py-1.5 text-sm"
              onClick={() => void refresh(false, { loadAll: true })}
            >
              Загрузить всё
            </button>
          </div>
        )}
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
              variant={tableVariant}
            />
          ) : (
            <QueueTable
              rows={filteredRows as QueueItem[]}
              onSendOne={(id) => sendOne(id, false)}
              sendingId={sendingId}
              onToggleAutoExclude={toggleAutoExclude}
              togglingId={togglingId}
              variant={tableVariant}
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
