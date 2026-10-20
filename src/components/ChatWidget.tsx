"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import type { ChatMessage, ChatThread, ChatThreadSummary } from "@/lib/chat/types";
import {
  CHAT_AGENT_NAME,
  CHAT_WS_PATH,
  DEFAULT_CHAT_SETTINGS,
  countUnreadAfter,
  isMessageReadByPeer,
} from "@/lib/chat/types";
import { playChatNotifySound } from "@/lib/chat/sound";
import { useActiveRead } from "@/lib/chat/use-active-read";
import { MessageTicks } from "@/components/chat/MessageTicks";
import {
  ChatOfflineOffer,
  type OfflineOfferPhase,
} from "@/components/chat/ChatOfflineOffer";
import type { QuizOutcome } from "@/lib/types";

const VISITOR_KEY = "navicert_chat_visitor";

function getOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY)?.trim();
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `v_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return `v_${Date.now()}`;
  }
}

function wsUrl(visitorId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${CHAT_WS_PATH}?role=visitor&visitorId=${encodeURIComponent(visitorId)}`;
}

type ChatWidgetProps = {
  /** С сервера — чтобы иконка сразу нужного цвета, без мигания дефолта. */
  initialLauncherColor?: string;
  initialGreetingDelaySec?: number;
  initialOfflineAfterVisitorSec?: number;
  initialWaitingReplyText?: string;
};

export function ChatWidget({
  initialLauncherColor,
  initialGreetingDelaySec,
  initialOfflineAfterVisitorSec,
  initialWaitingReplyText,
}: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [visitorId, setVisitorId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [greeted, setGreeted] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  /** Реальный presence: админ в разделе Чат (heartbeat / прочитал / ответил). */
  const [agentOnline, setAgentOnline] = useState(false);
  const [unread, setUnread] = useState(0);
  /** Тик, чтобы через минуту после сообщения посетителя статус стал «не в сети». */
  const [statusTick, setStatusTick] = useState(0);
  const [greetDelayMs, setGreetDelayMs] = useState(
    (typeof initialGreetingDelaySec === "number" &&
    Number.isFinite(initialGreetingDelaySec)
      ? initialGreetingDelaySec
      : DEFAULT_CHAT_SETTINGS.greetingDelaySec) * 1000
  );
  const [offlineAfterMs, setOfflineAfterMs] = useState(
    (typeof initialOfflineAfterVisitorSec === "number" &&
    Number.isFinite(initialOfflineAfterVisitorSec)
      ? initialOfflineAfterVisitorSec
      : DEFAULT_CHAT_SETTINGS.offlineAfterVisitorSec) * 1000
  );
  const [waitingReplyText, setWaitingReplyText] = useState(
    initialWaitingReplyText?.trim() || DEFAULT_CHAT_SETTINGS.waitingReplyText
  );
  const [launcherColor, setLauncherColor] = useState(
    initialLauncherColor && /^#[0-9a-fA-F]{6}$/.test(initialLauncherColor)
      ? initialLauncherColor.toLowerCase()
      : DEFAULT_CHAT_SETTINGS.launcherColor
  );
  const [lastReadByAdmin, setLastReadByAdmin] = useState<string | null>(null);
  const [offlineOffer, setOfflineOffer] = useState<OfflineOfferPhase | null>(
    null
  );
  const [leadOutcome, setLeadOutcome] = useState<QuizOutcome | null>(null);
  /** История треда подгружена — до этого не считаем офлайн. */
  const [historyReady, setHistoryReady] = useState(false);
  /** Заявка из чата уже есть — повторно не предлагаем оформлять. */
  const [hasLead, setHasLead] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const greetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const lastReadByVisitorRef = useRef<string | null>(null);
  const readInFlightRef = useRef(false);
  const andreyOnlineRef = useRef<boolean | null>(null);
  /** id последнего видимого сообщения на момент показа waiting/done — сбрасываем оффер при новом. */
  const offerBannerAtMsgIdRef = useRef<string | null>(null);

  const setOpenAndRef = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
  }, []);

  const applyReadCursor = useCallback(
    (partial: {
      lastReadByVisitor?: string | null;
      lastReadByAdmin?: string | null;
    }) => {
      if (partial.lastReadByVisitor !== undefined) {
        lastReadByVisitorRef.current = partial.lastReadByVisitor;
      }
      if (partial.lastReadByAdmin !== undefined) {
        setLastReadByAdmin(partial.lastReadByAdmin);
      }
    },
    []
  );

  const syncUnread = useCallback(
    (msgs: ChatMessage[], readId: string | null) => {
      if (openRef.current) {
        setUnread(0);
        return;
      }
      const n = countUnreadAfter(msgs, readId, "agent");
      setUnread(n);
      if (n > 0) setPeek(true);
    },
    []
  );

  const markReadOnServer = useCallback(async (id: string) => {
    if (readInFlightRef.current) return;
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (!last || lastReadByVisitorRef.current === last.id) return;
    readInFlightRef.current = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", visitorId: id }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: ChatThread };
      if (data.thread) {
        applyReadCursor({
          lastReadByVisitor: data.thread.lastReadByVisitor,
          lastReadByAdmin: data.thread.lastReadByAdmin,
        });
        setUnread(0);
      }
    } finally {
      readInFlightRef.current = false;
    }
  }, [applyReadCursor]);

  const applyThread = useCallback(
    (thread: ChatThread) => {
      const msgs = thread.messages || [];
      messagesRef.current = msgs;
      setMessages(msgs);
      setGreeted(Boolean(thread.greeted));
      setHasLead(Boolean(thread.leadId?.trim() || thread.visitorName?.trim()));
      applyReadCursor({
        lastReadByVisitor: thread.lastReadByVisitor ?? null,
        lastReadByAdmin: thread.lastReadByAdmin ?? null,
      });
      for (const msg of msgs) {
        knownMessageIdsRef.current.add(msg.id);
      }
      if (openRef.current) {
        setUnread(0);
      } else {
        syncUnread(msgs, thread.lastReadByVisitor ?? null);
      }
    },
    [applyReadCursor, syncUnread]
  );

  const loadThread = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chat?visitorId=${encodeURIComponent(id)}`);
        if (res.ok) {
          const data = (await res.json()) as { thread?: ChatThread };
          if (data.thread) applyThread(data.thread);
        }
      } finally {
        setHistoryReady(true);
        andreyOnlineRef.current = null;
      }
    },
    [applyThread]
  );

  const triggerGreeting = useCallback(
    async (id: string) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "greet", visitorId: id }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        thread?: ChatThread;
        created?: boolean;
        message?: ChatMessage;
      };
      if (data.thread) applyThread(data.thread);
      if (data.created && data.message) {
        const isNew = !knownMessageIdsRef.current.has(data.message.id);
        knownMessageIdsRef.current.add(data.message.id);
        if (isNew) {
          if (!openRef.current) setPeek(true);
          playChatNotifySound();
        }
      }
    },
    [applyThread]
  );

  useEffect(() => {
    const id = getOrCreateVisitorId();
    setVisitorId(id);
    void loadThread(id);
    void fetch("/api/chat/settings")
      .then((res) => res.json())
      .then(
        (data: {
          settings?: {
            greetingDelaySec?: number;
            offlineAfterVisitorSec?: number;
            waitingReplyText?: string;
            launcherColor?: string;
          };
        }) => {
          const greetSec = data.settings?.greetingDelaySec;
          if (typeof greetSec === "number" && Number.isFinite(greetSec)) {
            setGreetDelayMs(Math.round(greetSec) * 1000);
          }
          const offlineSec = data.settings?.offlineAfterVisitorSec;
          if (typeof offlineSec === "number" && Number.isFinite(offlineSec)) {
            setOfflineAfterMs(Math.round(offlineSec) * 1000);
          }
          const waitText = data.settings?.waitingReplyText?.trim();
          if (waitText) setWaitingReplyText(waitText);
          const color = data.settings?.launcherColor?.trim();
          if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
            setLauncherColor(color.toLowerCase());
          }
        }
      )
      .catch(() => {
        /* defaults */
      });
  }, [loadThread]);

  /**
   * Всплывашка с приветствием:
   * — первый раз: создаём сообщение (ensureGreeting);
   * — повторный заход в новой сессии браузера: то же сообщение, без дубля,
   *   просто снова показываем peek (sessionStorage сбрасывается с закрытием браузера).
   */
  useEffect(() => {
    if (!visitorId || !historyReady || open) return;

    const sessionKey = `navicert_chat_peek_${visitorId}`;
    try {
      if (sessionStorage.getItem(sessionKey) === "1") return;
    } catch {
      /* private mode — всё равно покажем */
    }

    greetTimerRef.current = setTimeout(() => {
      if (openRef.current) return;

      const markSessionPeek = () => {
        try {
          sessionStorage.setItem(sessionKey, "1");
        } catch {
          /* ignore */
        }
      };

      if (greeted) {
        const hasAgent = messagesRef.current.some(
          (m) => m.role === "agent" && !m.adminOnly
        );
        if (hasAgent) {
          setPeek(true);
          markSessionPeek();
        }
        return;
      }

      void triggerGreeting(visitorId).finally(markSessionPeek);
    }, greetDelayMs);

    return () => {
      if (greetTimerRef.current) clearTimeout(greetTimerRef.current);
    };
  }, [
    visitorId,
    historyReady,
    greeted,
    greetDelayMs,
    open,
    triggerGreeting,
  ]);

  // Две галки — только после реального действия при открытом чате.
  useActiveRead(open && Boolean(visitorId), () => {
    if (visitorId) void markReadOnServer(visitorId);
  });

  useEffect(() => {
    if (!visitorId) return;

    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl(visitorId));
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        attempt += 1;
        const delay = Math.min(8000, 1000 * 2 ** Math.min(attempt, 3));
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        /* onclose reconnect */
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            type?: string;
            online?: boolean;
            agentOnline?: boolean;
            message?: ChatMessage;
            thread?: ChatThreadSummary;
          };

          if (data.type === "hello" && typeof data.agentOnline === "boolean") {
            setAgentOnline(data.agentOnline);
          }
          if (
            data.type === "agent_presence" &&
            typeof data.online === "boolean"
          ) {
            setAgentOnline(data.online);
          }

          if (
            (data.type === "read" || data.type === "thread_upsert") &&
            data.thread
          ) {
            if (data.type === "read" && data.agentOnline) {
              setAgentOnline(true);
            }
            if (data.thread.leadId || data.thread.visitorName) {
              setHasLead(true);
            }
            applyReadCursor({
              lastReadByVisitor: data.thread.lastReadByVisitor,
              lastReadByAdmin: data.thread.lastReadByAdmin,
            });
            if (!openRef.current) {
              syncUnread(
                messagesRef.current,
                data.thread.lastReadByVisitor ?? null
              );
            }
            return;
          }

          if (data.type === "message" && data.message) {
            const msg = data.message;
            const isNew = !knownMessageIdsRef.current.has(msg.id);
            if (!isNew) return;
            knownMessageIdsRef.current.add(msg.id);

            if (data.thread?.leadId || data.thread?.visitorName) {
              setHasLead(true);
            }

            const prev = messagesRef.current;
            if (prev.some((m) => m.id === msg.id)) return;
            const next = [...prev, msg];
            messagesRef.current = next;
            setMessages(next);

            if (data.thread) {
              applyReadCursor({
                lastReadByVisitor: data.thread.lastReadByVisitor,
                lastReadByAdmin: data.thread.lastReadByAdmin,
              });
            }

            if (msg.role === "agent") {
              setAgentOnline(true);
              if (openRef.current) {
                setUnread(0);
              } else {
                setPeek(true);
                setUnread((n) => n + 1);
              }
              playChatNotifySound();
            }
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
  }, [visitorId, applyReadCursor, syncUnread]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // После сообщения посетителя через N сек статус «онлайн» гаснет, пока админ не ответит.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => !m.adminOnly);
    if (!last || last.role !== "visitor") return;
    const sentAt = Date.parse(last.createdAt);
    if (!Number.isFinite(sentAt)) return;
    const left = offlineAfterMs - (Date.now() - sentAt);
    if (left <= 0) {
      setStatusTick((n) => n + 1);
      return;
    }
    const timer = setTimeout(() => setStatusTick((n) => n + 1), left + 30);
    return () => clearTimeout(timer);
  }, [messages, offlineAfterMs]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || !visitorId || sending) return;
    setSending(true);
    setText("");
    setPeek(false);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          visitorId,
          text: value,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        thread?: ChatThread;
        message?: ChatMessage;
      };
      if (data.message) knownMessageIdsRef.current.add(data.message.id);
      if (data.thread) applyThread(data.thread);
    } finally {
      setSending(false);
    }
  }

  function openChat() {
    setOpenAndRef(true);
    setPeek(false);
    setUnread(0);
  }

  function closeChat() {
    setOpenAndRef(false);
  }

  const visibleMessages = messages.filter((m) => !m.adminOnly);
  const lastAgent = [...visibleMessages].reverse().find((m) => m.role === "agent");
  // Статус Андрея (по последнему видимому сообщению):
  // — нет истории / только ждём приветствие → онлайн;
  // — последнее от агента → онлайн;
  // — последнее от посетителя → онлайн ещё N сек, потом офлайн
  //   (heartbeat админки после N сек не держит «онлайн»).
  void statusTick;
  const lastVisible = visibleMessages[visibleMessages.length - 1];
  const andreyOnline = (() => {
    if (!historyReady) return true;
    if (!lastVisible) return true;
    if (lastVisible.role === "agent") return true;
    const sentAt = Date.parse(lastVisible.createdAt);
    if (!Number.isFinite(sentAt)) return true;
    return Date.now() - sentAt < offlineAfterMs;
  })();

  const hasVisitorMessage = visibleMessages.some((m) => m.role === "visitor");

  // При уходе в офлайн — предложить подождать или оформить заявку.
  useEffect(() => {
    if (!historyReady) return;

    const prev = andreyOnlineRef.current;
    andreyOnlineRef.current = andreyOnline;

    if (andreyOnline) {
      setOfflineOffer((cur) => (cur === "done" ? cur : null));
      return;
    }

    // Офлайн: смена true→false или уже офлайн при первом расчёте после загрузки.
    if (prev !== true && prev !== null) return;
    if (!hasVisitorMessage) return;
    setOfflineOffer((cur) => {
      if (cur === "waiting" || cur === "quiz" || cur === "form" || cur === "done")
        return cur;
      return "prompt";
    });
  }, [andreyOnline, hasVisitorMessage, historyReady]);

  useEffect(() => {
    if (offlineOffer == null) {
      setLeadOutcome(null);
      offerBannerAtMsgIdRef.current = null;
    }
  }, [offlineOffer]);

  // Всплывашка waiting/done пропадает после любого нового сообщения (с любой стороны).
  useEffect(() => {
    if (offlineOffer !== "waiting" && offlineOffer !== "done") return;
    const baseline = offerBannerAtMsgIdRef.current;
    if (baseline == null) return;
    const lastId = visibleMessages[visibleMessages.length - 1]?.id ?? "__none__";
    if (lastId !== baseline) {
      offerBannerAtMsgIdRef.current = null;
      setOfflineOffer(null);
    }
  }, [visibleMessages, offlineOffer]);

  useEffect(() => {
    if (!offlineOffer || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [offlineOffer, leadOutcome]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {peek && !open && lastAgent && (
        <button
          type="button"
          onClick={openChat}
          className="pointer-events-auto max-w-[280px] rounded-2xl border border-border bg-white px-4 py-3 text-left shadow-xl"
        >
          <p className="text-xs font-semibold text-primary-dark">
            {CHAT_AGENT_NAME}
          </p>
          <p className="mt-1 text-sm leading-snug text-foreground">
            {lastAgent.text}
          </p>
        </button>
      )}

      {open && (
        <div className="pointer-events-auto flex h-[min(520px,70vh)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
          <div className="flex items-center gap-3 bg-gradient-to-r from-primary to-primary-light px-4 py-3 text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
              А
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight">{CHAT_AGENT_NAME}</p>
              <p className="flex items-center gap-1.5 text-xs text-white/80">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    !connected
                      ? "bg-white/50"
                      : andreyOnline
                        ? "bg-emerald-300"
                        : "bg-white/40"
                  }`}
                />
                {!connected
                  ? "Связь восстанавливается…"
                  : andreyOnline
                    ? "Онлайн"
                    : "Не в сети"}
              </p>
            </div>
            <button
              type="button"
              onClick={closeChat}
              className="rounded-lg p-1.5 hover:bg-white/15"
              aria-label="Закрыть чат"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            ref={listRef}
            className="flex-1 space-y-3 overflow-y-auto bg-[#f4f7fb] px-3 py-4"
          >
            {messages.length === 0 && (
              <p className="px-2 text-center text-sm text-muted">
                Напишите вопрос — ответим здесь.
              </p>
            )}
            {messages
              .filter((msg) => !msg.adminOnly)
              .map((msg) => {
              const mine = msg.role === "visitor";
              const read = mine
                ? isMessageReadByPeer(messages, msg.id, lastReadByAdmin)
                : false;
              return (
                <div
                  key={msg.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                      mine
                        ? "rounded-br-md bg-primary text-white"
                        : "rounded-bl-md bg-white text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    {mine && (
                      <p className="mt-1 flex justify-end">
                        <MessageTicks read={read} onDark />
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {offlineOffer && visitorId && (
              <ChatOfflineOffer
                visitorId={visitorId}
                phase={offlineOffer}
                waitingReplyText={waitingReplyText}
                hasLead={hasLead}
                outcome={leadOutcome}
                onWait={() => {
                  offerBannerAtMsgIdRef.current =
                    visibleMessages[visibleMessages.length - 1]?.id ?? "__none__";
                  setOfflineOffer("waiting");
                }}
                onStartQuiz={() => {
                  setLeadOutcome(null);
                  setOfflineOffer("quiz");
                }}
                onQuizFinished={(o) => {
                  setLeadOutcome(o);
                  setOfflineOffer("form");
                }}
                onDone={() => {
                  setHasLead(true);
                  offerBannerAtMsgIdRef.current =
                    visibleMessages[visibleMessages.length - 1]?.id ?? "__none__";
                  setOfflineOffer("done");
                }}
              />
            )}
          </div>

          <form
            onSubmit={sendMessage}
            className="flex items-end gap-2 border-t border-border bg-white p-3"
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={1}
              placeholder="Ваше сообщение…"
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(e);
                }
              }}
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-accent text-white disabled:opacity-40"
              aria-label="Отправить"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => (open ? closeChat() : openChat())}
        className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-105 hover:brightness-110"
        style={{ backgroundColor: launcherColor }}
        aria-label={
          open
            ? "Закрыть чат"
            : unread > 0
              ? `Открыть чат, непрочитанных: ${unread}`
              : "Открыть чат"
        }
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : unread > 0 ? (
          <span className="relative flex h-8 w-8 items-center justify-center">
            <MessageCircle
              className="absolute inset-0 h-8 w-8"
              strokeWidth={2}
              aria-hidden
            />
            <span
              className="relative z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-0.5 text-[11px] font-bold leading-none"
              style={{ color: launcherColor }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          </span>
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}
