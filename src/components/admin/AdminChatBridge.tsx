"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageCircle, X } from "lucide-react";
import type { ChatMessage, ChatThreadSummary } from "@/lib/chat/types";
import { CHAT_AGENT_HEARTBEAT_MS, CHAT_WS_PATH } from "@/lib/chat/types";
import { playChatNotifySound } from "@/lib/chat/sound";
import { useActiveRead } from "@/lib/chat/use-active-read";

type ChatToast = {
  id: string;
  visitorId: string;
  preview: string;
};

type AdminChatBridgeValue = {
  unreadTotal: number;
  /** Открыть диалог из тоста / бейджа. */
  openChatThread: (visitorId?: string) => void;
  /** ChatPanel забирает visitorId после перехода в раздел. */
  pendingVisitorId: string | null;
  clearPendingVisitorId: () => void;
};

const AdminChatBridgeContext = createContext<AdminChatBridgeValue | null>(null);

function wsAdminUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${CHAT_WS_PATH}?role=admin`;
}

export function useAdminChatBridge(): AdminChatBridgeValue {
  const ctx = useContext(AdminChatBridgeContext);
  if (!ctx) {
    return {
      unreadTotal: 0,
      openChatThread: () => undefined,
      pendingVisitorId: null,
      clearPendingVisitorId: () => undefined,
    };
  }
  return ctx;
}

export function AdminChatBridge({
  enabled,
  muteToasts = false,
  onNavigateToChat,
  children,
}: {
  enabled: boolean;
  /** На вкладке Чат всплывашки не нужны — диалоги уже на экране. */
  muteToasts?: boolean;
  onNavigateToChat: () => void;
  children: React.ReactNode;
}) {
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [toasts, setToasts] = useState<ChatToast[]>([]);
  const [pendingVisitorId, setPendingVisitorId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const muteToastsRef = useRef(muteToasts);
  muteToastsRef.current = muteToasts;

  const recomputeUnread = useCallback((threads: ChatThreadSummary[]) => {
    setUnreadTotal(
      threads.reduce((sum, t) => sum + (t.unreadByAdmin || 0), 0)
    );
  }, []);

  const loadUnread = useCallback(async () => {
    const res = await fetch("/api/admin/chat", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as { threads?: ChatThreadSummary[] };
    recomputeUnread(data.threads || []);
  }, [recomputeUnread]);

  const sendHeartbeat = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "agent_heartbeat" }));
    }
  }, []);

  // Presence: любая вкладка админки + активность мыши/клавиатуры.
  useActiveRead(enabled, sendHeartbeat);

  useEffect(() => {
    if (!enabled) return;
    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, CHAT_AGENT_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [enabled, sendHeartbeat]);

  useEffect(() => {
    if (!enabled) return;
    void loadUnread();
  }, [enabled, loadUnread]);

  useEffect(() => {
    if (!enabled) return;

    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsAdminUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "agent_heartbeat" }));
      };
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
            message?: ChatMessage;
            thread?: ChatThreadSummary & { visitorId: string };
          };

          if (
            (data.type === "thread_upsert" || data.type === "read") &&
            data.thread
          ) {
            void loadUnread();
          }

          if (data.type === "message" && data.message && data.visitorId) {
            const msg = data.message;
            const isNew = !knownIdsRef.current.has(msg.id);
            knownIdsRef.current.add(msg.id);
            if (!isNew || msg.role !== "visitor") return;

            playChatNotifySound();
            void loadUnread();

            if (muteToastsRef.current) return;

            const preview =
              msg.text.trim().slice(0, 100) || "Новое сообщение";
            const toastId = msg.id;
            setToasts((prev) => {
              const next = [
                { id: toastId, visitorId: data.visitorId!, preview },
                ...prev.filter((t) => t.visitorId !== data.visitorId),
              ];
              return next.slice(0, 4);
            });
            window.setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== toastId));
            }, 8000);
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
  }, [enabled, loadUnread]);

  const openChatThread = useCallback(
    (visitorId?: string) => {
      if (visitorId) setPendingVisitorId(visitorId);
      onNavigateToChat();
      setToasts((prev) =>
        visitorId ? prev.filter((t) => t.visitorId !== visitorId) : []
      );
    },
    [onNavigateToChat]
  );

  const clearPendingVisitorId = useCallback(() => {
    setPendingVisitorId(null);
  }, []);

  const value = useMemo(
    () => ({
      unreadTotal,
      openChatThread,
      pendingVisitorId,
      clearPendingVisitorId,
    }),
    [unreadTotal, openChatThread, pendingVisitorId, clearPendingVisitorId]
  );

  return (
    <AdminChatBridgeContext.Provider value={value}>
      {children}
      {enabled && toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 sm:bottom-6 sm:right-6">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto relative overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
            >
              <button
                type="button"
                onClick={() => openChatThread(toast.visitorId)}
                className="flex w-full items-start gap-3 py-3 pl-4 pr-10 text-left transition hover:bg-slate-50"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                  <MessageCircle className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-primary-dark">
                    Новое сообщение в чате
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-sm text-muted">
                    {toast.preview}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id))
                }
                className="absolute right-2 top-2 rounded-lg p-1 text-muted hover:bg-slate-100 hover:text-foreground"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </AdminChatBridgeContext.Provider>
  );
}
