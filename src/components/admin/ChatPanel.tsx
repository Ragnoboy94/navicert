"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  MessageCircle,
  RefreshCw,
  Send,
  Settings,
  Star,
  X,
} from "lucide-react";
import type {
  ChatMessage,
  ChatSettings,
  ChatThread,
  ChatThreadSummary,
} from "@/lib/chat/types";
import {
  CHAT_WS_PATH,
  DEFAULT_CHAT_SETTINGS,
  chatVisitorLabel,
  isMessageReadByPeer,
} from "@/lib/chat/types";
import { useActiveRead } from "@/lib/chat/use-active-read";
import { useAdminChatBridge } from "@/components/admin/AdminChatBridge";
import { AdminPushSetup } from "@/components/admin/AdminPushSetup";
import {
  AdminCard,
  Field,
  SaveButton,
  TextArea,
  TextInput,
  useSaveStatus,
} from "@/components/admin/ui";
import { MessageTicks } from "@/components/chat/MessageTicks";

function wsAdminUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${CHAT_WS_PATH}?role=admin`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ChatPanel() {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());
  const [settings, setSettings] = useState<ChatSettings>({
    ...DEFAULT_CHAT_SETTINGS,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { status: settingsStatus, run: runSettingsSave } = useSaveStatus();
  const { pendingVisitorId, clearPendingVisitorId } = useAdminChatBridge();
  const listRef = useRef<HTMLDivElement>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!pendingVisitorId) return;
    setActiveId(pendingVisitorId);
    clearPendingVisitorId();
  }, [pendingVisitorId, clearPendingVisitorId]);

  const sortThreads = useCallback((list: ChatThreadSummary[]) => {
    return [...list].sort((a, b) => {
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
  }, []);

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/admin/chat", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      threads?: ChatThreadSummary[];
      settings?: ChatSettings;
    };
    setThreads(sortThreads(data.threads || []));
    if (data.settings) setSettings(data.settings);
    setLoading(false);
  }, [sortThreads]);

  async function saveSettings() {
    await runSettingsSave(async () => {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "settings", settings }),
      });
      if (!res.ok) throw new Error("save_failed");
      const data = (await res.json()) as { settings?: ChatSettings };
      if (data.settings) setSettings(data.settings);
    });
  }

  const loadThread = useCallback(async (visitorId: string) => {
    const res = await fetch(
      `/api/admin/chat?visitorId=${encodeURIComponent(visitorId)}`,
      { credentials: "same-origin" }
    );
    if (!res.ok) return;
    const data = (await res.json()) as { thread?: ChatThread };
    if (data.thread) setThread(data.thread);
  }, []);

  const markReadOnServer = useCallback(async (visitorId: string) => {
    const res = await fetch("/api/admin/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", visitorId }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { thread?: ChatThread };
    if (!data.thread) return;
    setThread(data.thread);
    setThreads((prev) =>
      prev.map((t) =>
        t.visitorId === visitorId
          ? {
              ...t,
              unreadByAdmin: 0,
              lastReadByAdmin: data.thread!.lastReadByAdmin,
              lastReadByVisitor: data.thread!.lastReadByVisitor,
            }
          : t
      )
    );
  }, []);

  async function toggleFavorite(visitorId: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    e?.preventDefault();
    const res = await fetch("/api/admin/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "favorite", visitorId }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { thread?: ChatThread };
    if (!data.thread) return;
    const favorited = Boolean(data.thread.favorited);
    setThread((prev) =>
      prev && prev.visitorId === visitorId ? { ...prev, favorited } : prev
    );
    setThreads((prev) =>
      sortThreads(
        prev.map((t) =>
          t.visitorId === visitorId ? { ...t, favorited } : t
        )
      )
    );
  }

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeId) void loadThread(activeId);
  }, [activeId, loadThread]);

  // Галочки «прочитано» — когда админ шевелится в открытом диалоге.
  // Presence/звук/тосты — глобально в AdminChatBridge на всей админке.
  useActiveRead(Boolean(activeId), () => {
    if (activeId) void markReadOnServer(activeId);
  });

  useEffect(() => {
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsAdminUrl());
      wsRef.current = ws;
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!closed) retryTimer = setTimeout(connect, 2500);
      };
      ws.onerror = () => {
        /* onclose reconnect */
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            type?: string;
            visitorId?: string;
            online?: boolean;
            onlineVisitorIds?: string[];
            message?: ChatMessage;
            thread?: ChatThreadSummary & { visitorId: string };
          };
          if (data.type === "hello" && Array.isArray(data.onlineVisitorIds)) {
            setOnlineIds(new Set(data.onlineVisitorIds));
          }
          if (data.type === "presence" && data.visitorId) {
            setOnlineIds((prev) => {
              const next = new Set(prev);
              if (data.online) next.add(data.visitorId!);
              else next.delete(data.visitorId!);
              return next;
            });
          }
          if (
            (data.type === "thread_upsert" || data.type === "read") &&
            data.thread
          ) {
            setThreads((prev) => {
              const next = prev.filter((t) => t.id !== data.thread!.id);
              next.unshift({
                ...data.thread!,
                favorited: Boolean(data.thread!.favorited),
              });
              return next.sort((a, b) => {
                if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
                return b.lastMessageAt.localeCompare(a.lastMessageAt);
              });
            });
            setThread((prev) => {
              if (!prev || prev.visitorId !== data.thread!.visitorId) return prev;
              return {
                ...prev,
                unreadByAdmin: data.thread!.unreadByAdmin,
                favorited: Boolean(data.thread!.favorited),
                lastReadByVisitor: data.thread!.lastReadByVisitor,
                lastReadByAdmin: data.thread!.lastReadByAdmin,
                visitorName:
                  data.thread!.visitorName ?? prev.visitorName,
                visitorPhone:
                  data.thread!.visitorPhone ?? prev.visitorPhone,
                leadId: data.thread!.leadId ?? prev.leadId,
              };
            });
          }
          if (data.type === "message" && data.message && data.visitorId) {
            const msg = data.message;
            const isNew = !knownIdsRef.current.has(msg.id);
            knownIdsRef.current.add(msg.id);
            setThread((prev) => {
              if (!prev || prev.visitorId !== data.visitorId) return prev;
              if (prev.messages.some((m) => m.id === msg.id)) return prev;
              return {
                ...prev,
                messages: [...prev.messages, msg],
                lastMessageAt: msg.createdAt,
                lastReadByVisitor:
                  data.thread?.lastReadByVisitor ?? prev.lastReadByVisitor,
                lastReadByAdmin:
                  data.thread?.lastReadByAdmin ?? prev.lastReadByAdmin,
                unreadByAdmin:
                  data.thread?.unreadByAdmin ?? prev.unreadByAdmin,
                visitorName:
                  data.thread?.visitorName ?? prev.visitorName,
                visitorPhone:
                  data.thread?.visitorPhone ?? prev.visitorPhone,
                leadId: data.thread?.leadId ?? prev.leadId,
              };
            });
            setThreads((prev) =>
              prev.map((t) =>
                t.visitorId === data.visitorId
                  ? {
                      ...t,
                      unreadByAdmin:
                        data.visitorId !== activeIdRef.current &&
                        isNew &&
                        msg.role === "visitor"
                          ? (data.thread?.unreadByAdmin ??
                            (t.unreadByAdmin || 0) + 1)
                          : (data.thread?.unreadByAdmin ?? t.unreadByAdmin),
                      preview: msg.text.slice(0, 120),
                      lastMessageAt: msg.createdAt,
                      lastReadByVisitor:
                        data.thread?.lastReadByVisitor ?? t.lastReadByVisitor,
                      lastReadByAdmin:
                        data.thread?.lastReadByAdmin ?? t.lastReadByAdmin,
                      visitorName:
                        data.thread?.visitorName ?? t.visitorName,
                      visitorPhone:
                        data.thread?.visitorPhone ?? t.visitorPhone,
                      leadId: data.thread?.leadId ?? t.leadId,
                    }
                  : t
              )
            );
          }
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages]);

  const unreadTotal = useMemo(
    () => threads.reduce((sum, t) => sum + (t.unreadByAdmin || 0), 0),
    [threads]
  );

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !text.trim() || sending) return;
    setSending(true);
    const value = text.trim();
    setText("");
    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: activeId, text: value }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: ChatThread };
      if (data.thread) setThread(data.thread);
    } finally {
      setSending(false);
    }
  }

  const mobileChatOpen = Boolean(activeId);

  return (
    <div className="space-y-3">
      <div className={mobileChatOpen ? "hidden lg:block" : undefined}>
        <AdminPushSetup />
      </div>
      <AdminCard
        title="Онлайн-чат"
        description="Диалоги с посетителями сайта."
        className={
          mobileChatOpen
            ? "border-0 bg-transparent shadow-none max-lg:[&>div:first-child]:hidden max-lg:[&>div]:p-0 lg:rounded-2xl lg:border lg:border-border lg:bg-white lg:shadow-sm"
            : "max-lg:[&>div:first-child]:hidden"
        }
      >
        <div
          className={`mb-3 flex flex-wrap items-center gap-2 text-sm ${
            mobileChatOpen ? "hidden lg:flex" : ""
          }`}
        >
          {unreadTotal > 0 && (
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-white">
              непрочитанных: {unreadTotal}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadThreads()}
            className="btn-ghost gap-2 px-3 py-2 text-sm"
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0" />
            Обновить
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn-ghost ml-auto gap-2 px-3 py-2 text-sm"
            aria-label="Настройки автоприветствия"
            title="Автоприветствие"
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Настройки</span>
          </button>
        </div>

        {settingsOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-settings-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-primary-dark/45 backdrop-blur-[2px]"
              aria-label="Закрыть"
              onClick={() => setSettingsOpen(false)}
            />
            <div className="relative w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="chat-settings-title"
                    className="text-lg font-bold text-primary-dark"
                  >
                    Настройки чата
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    Приветствие и когда показывать «не в сети».
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-lg p-1.5 text-muted hover:bg-slate-100 hover:text-foreground"
                  aria-label="Закрыть"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4">
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/60 px-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={Boolean(settings.customChatEnabled)}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        customChatEnabled: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      Свой чат вместо Chaport
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      Выкл — на сайте Chaport из настроек сайта. Вкл — Chaport
                      не грузится, работает новый чат.
                    </span>
                  </span>
                </label>
                <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                  <Field label="Текст автоприветствия">
                    <TextArea
                      rows={3}
                      value={settings.greetingText}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          greetingText: e.target.value,
                        }))
                      }
                      placeholder="Здравствуйте! Я могу Вам помочь?"
                      disabled={!settings.customChatEnabled}
                    />
                  </Field>
                  <Field label="Через сколько, сек" hint="от 3 до 300">
                    <TextInput
                      type="number"
                      min={3}
                      max={300}
                      value={settings.greetingDelaySec}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          greetingDelaySec: Number(e.target.value) || 15,
                        }))
                      }
                      disabled={!settings.customChatEnabled}
                    />
                  </Field>
                </div>
                <Field
                  label="Офлайн после ответа посетителя, сек"
                  hint="от 15 до 600 · если админ не в чате"
                >
                  <TextInput
                    type="number"
                    min={15}
                    max={600}
                    value={settings.offlineAfterVisitorSec}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        offlineAfterVisitorSec: Number(e.target.value) || 60,
                      }))
                    }
                    disabled={!settings.customChatEnabled}
                  />
                </Field>
                <Field
                  label="Текст «Дождаться ответа»"
                  hint="показывается после выбора ожидания"
                >
                  <TextArea
                    rows={2}
                    value={settings.waitingReplyText}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        waitingReplyText: e.target.value,
                      }))
                    }
                    placeholder="Хорошо, ответим в скором времени."
                    disabled={!settings.customChatEnabled}
                  />
                </Field>
                <Field
                  label="Цвет иконки чата"
                  hint="кнопка в углу сайта"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-white p-1 disabled:opacity-40"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(settings.launcherColor)
                          ? settings.launcherColor
                          : "#00b8f0"
                      }
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          launcherColor: e.target.value,
                        }))
                      }
                      disabled={!settings.customChatEnabled}
                      aria-label="Выбрать цвет иконки"
                    />
                    <TextInput
                      value={settings.launcherColor}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          launcherColor: e.target.value,
                        }))
                      }
                      placeholder="#00b8f0"
                      disabled={!settings.customChatEnabled}
                      className="max-w-[140px] font-mono text-sm"
                    />
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow"
                      style={{
                        backgroundColor: /^#[0-9a-fA-F]{6}$/.test(
                          settings.launcherColor
                        )
                          ? settings.launcherColor
                          : "#00b8f0",
                      }}
                      aria-hidden
                    >
                      <MessageCircle className="h-5 w-5" />
                    </span>
                  </div>
                </Field>
              </div>
              <div className="mt-5">
                <SaveButton
                  onClick={() => void saveSettings()}
                  status={settingsStatus}
                />
              </div>
            </div>
          </div>
        )}

        <div
          className={`grid overflow-hidden border-border bg-white max-lg:-mx-5 max-lg:-mb-5 max-lg:h-[calc(100dvh-10.5rem)] max-lg:min-h-[280px] max-lg:border-t sm:max-lg:-mx-6 sm:max-lg:-mb-6 lg:h-[min(720px,calc(100vh-14rem))] lg:min-h-[420px] lg:grid-cols-[280px_1fr] lg:rounded-2xl lg:border ${
            mobileChatOpen ? "max-lg:mx-0 max-lg:mb-0 max-lg:h-[calc(100dvh-5.5rem)] max-lg:rounded-2xl max-lg:border" : ""
          }`}
        >
          <aside
            className={`min-h-0 flex-col border-border bg-[#f8fafc] lg:border-r ${
              mobileChatOpen ? "hidden lg:flex" : "flex"
            }`}
          >
            <div className="shrink-0 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Диалоги ({threads.length})
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading && (
                <p className="p-4 text-sm text-muted">Загрузка…</p>
              )}
              {!loading && threads.length === 0 && (
                <p className="p-4 text-sm text-muted">
                  Пока пусто. Откройте сайт и подождите ~
                  {settings.greetingDelaySec} сек.
                </p>
              )}
              {threads.map((item) => (
                <div
                  key={item.id}
                  className={`flex w-full items-start gap-1 border-b border-border transition ${
                    activeId === item.visitorId
                      ? "bg-white"
                      : "hover:bg-white/70"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(item.visitorId)}
                    className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-primary-dark">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            onlineIds.has(item.visitorId)
                              ? "bg-emerald-500"
                              : "bg-slate-300"
                          }`}
                          title={
                            onlineIds.has(item.visitorId)
                              ? "На сайте сейчас"
                              : "Не на сайте"
                          }
                        />
                        <span className="truncate">
                          {chatVisitorLabel(item)}
                        </span>
                      </span>
                      {item.unreadByAdmin > 0 && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {item.unreadByAdmin}
                        </span>
                      )}
                    </div>
                    {item.visitorPhone && (
                      <p className="truncate text-[11px] text-muted">
                        {item.visitorPhone}
                      </p>
                    )}
                    <p className="line-clamp-2 text-xs text-muted">
                      {item.preview || "Нет сообщений"}
                    </p>
                    <p className="text-[11px] text-muted">
                      {formatTime(item.lastMessageAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => void toggleFavorite(item.visitorId, e)}
                    className={`mt-2.5 mr-2 shrink-0 rounded-lg p-1.5 transition ${
                      item.favorited
                        ? "text-amber-500 hover:bg-amber-50"
                        : "text-slate-300 hover:bg-slate-100 hover:text-amber-500"
                    }`}
                    aria-label={
                      item.favorited
                        ? "Убрать из избранного"
                        : "В избранное"
                    }
                    title={
                      item.favorited
                        ? "Убрать из избранного"
                        : "В избранное"
                    }
                  >
                    <Star
                      className="h-4 w-4"
                      fill={item.favorited ? "currentColor" : "none"}
                    />
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <section
            className={`min-h-0 flex-col bg-white ${
              mobileChatOpen ? "flex" : "hidden lg:flex"
            }`}
          >
            {!activeId || !thread ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted">
                <MessageCircle className="h-10 w-10 opacity-40" />
                <p className="text-sm">Выберите диалог</p>
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(null);
                      setThread(null);
                    }}
                    className="shrink-0 rounded-lg p-2 text-muted hover:bg-slate-100 hover:text-foreground lg:hidden"
                    aria-label="К списку диалогов"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-primary-dark">
                      {chatVisitorLabel(thread, { shortId: false })}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[
                        thread.visitorPhone,
                        onlineIds.has(thread.visitorId)
                          ? "сейчас на сайте"
                          : "не на сайте",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {thread.leadId && (
                      <a
                        href="/admin?section=leads"
                        className="mt-0.5 inline-block text-xs font-medium text-accent hover:underline"
                      >
                        Открыть заявки →
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleFavorite(thread.visitorId)}
                    className={`shrink-0 rounded-lg p-2 transition ${
                      thread.favorited
                        ? "text-amber-500 hover:bg-amber-50"
                        : "text-slate-300 hover:bg-slate-100 hover:text-amber-500"
                    }`}
                    aria-label={
                      thread.favorited
                        ? "Убрать из избранного"
                        : "В избранное"
                    }
                    title={
                      thread.favorited
                        ? "Убрать из избранного"
                        : "В избранное"
                    }
                  >
                    <Star
                      className="h-5 w-5"
                      fill={thread.favorited ? "currentColor" : "none"}
                    />
                  </button>
                </div>
                <div
                  ref={listRef}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[#f4f7fb] px-3 py-3 sm:px-4 sm:py-4"
                >
                  {thread.messages.map((msg) => {
                    const mine = msg.role === "agent";
                    const adminNote = Boolean(msg.adminOnly);
                    const read = mine
                      ? isMessageReadByPeer(
                          thread.messages,
                          msg.id,
                          thread.lastReadByVisitor
                        )
                      : false;
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${
                          adminNote
                            ? "justify-center"
                            : mine
                              ? "justify-end"
                              : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[80%] ${
                            adminNote
                              ? "w-full max-w-full rounded-xl border border-amber-200 bg-amber-50 text-foreground sm:max-w-full"
                              : mine
                                ? "rounded-br-md bg-primary text-white"
                                : "rounded-bl-md bg-white text-foreground"
                          }`}
                        >
                          <p className="break-words whitespace-pre-wrap">
                            {msg.text}
                          </p>
                          <p
                            className={`mt-1 flex items-center gap-1.5 text-[10px] ${
                              mine ? "justify-end text-white/70" : "text-muted"
                            }`}
                          >
                            <span>{formatTime(msg.createdAt)}</span>
                            {mine && <MessageTicks read={read} onDark />}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <form
                  onSubmit={sendReply}
                  className="flex shrink-0 items-end gap-2 border-t border-border bg-white p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:p-3"
                >
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={1}
                    placeholder="Ответ…"
                    className="input-field max-h-32 min-h-[44px] flex-1 resize-none py-2.5 text-base sm:min-h-[52px] sm:resize-y sm:text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendReply(e);
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={sending || !text.trim()}
                    className="btn-primary inline-flex h-11 w-11 shrink-0 items-center justify-center px-0 disabled:opacity-50 sm:w-auto sm:gap-2 sm:px-4"
                    aria-label="Отправить"
                  >
                    <Send className="h-4 w-4" />
                    <span className="hidden sm:inline">Отправить</span>
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </AdminCard>
    </div>
  );
}
