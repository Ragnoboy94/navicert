export type ChatRole = "visitor" | "agent";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  /** Только для админки (заявка из чата и т.п.) — виджету посетителя не показываем. */
  adminOnly?: boolean;
};

export type ChatThread = {
  id: string;
  visitorId: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  greeted: boolean;
  unreadByAdmin: number;
  /** Закреплён в избранном у админа. */
  favorited: boolean;
  /** Имя из заявки в чате (если оформил). */
  visitorName: string | null;
  /** Телефон из заявки в чате. */
  visitorPhone: string | null;
  /** id заявки в leads.json */
  leadId: string | null;
  /** Последнее сообщение, которое видел посетитель (открытый виджет). */
  lastReadByVisitor: string | null;
  /** Последнее сообщение, которое видел админ (открытый диалог). */
  lastReadByAdmin: string | null;
  messages: ChatMessage[];
};

export type ChatThreadSummary = {
  id: string;
  visitorId: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  greeted: boolean;
  unreadByAdmin: number;
  favorited: boolean;
  visitorName: string | null;
  visitorPhone: string | null;
  leadId: string | null;
  lastReadByVisitor: string | null;
  lastReadByAdmin: string | null;
  preview: string;
  messageCount: number;
};

export function chatVisitorLabel(
  thread: { visitorId: string; visitorName?: string | null },
  opts?: { shortId?: boolean }
): string {
  const name = thread.visitorName?.trim();
  if (name) return name;
  const id = thread.visitorId;
  const slice = opts?.shortId === false ? 13 : 8;
  return `Посетитель ${id.slice(0, slice)}…`;
}

export const CHAT_GREETING = "Здравствуйте! Я могу Вам помочь?";

export const CHAT_AGENT_NAME = "Андрей";

export const CHAT_WS_PATH = "/api/chat/ws";

/** Через сколько без heartbeat админ считается away (сервер). */
export const CHAT_AGENT_AWAY_MS = 2 * 60 * 1000;

/** Как часто админка шлёт heartbeat, пока открыт раздел Чат. */
export const CHAT_AGENT_HEARTBEAT_MS = 30_000;

/**
 * Дефолт: после сообщения посетителя Андрей ещё столько мс «онлайн» в виджете.
 * Реальное значение — из настроек `offlineAfterVisitorSec`.
 */
export const CHAT_AFTER_VISITOR_ONLINE_MS = 60_000;

export type ChatSettings = {
  /**
   * Свой чат вместо Chaport.
   * false (по умолчанию) — на сайте только Chaport из site.json;
   * true — Chaport не грузится, работает виджет Navicert.
   */
  customChatEnabled: boolean;
  /** Текст автоприветствия. */
  greetingText: string;
  /** Задержка до автоприветствия, секунды. */
  greetingDelaySec: number;
  /**
   * Сколько секунд после сообщения посетителя показывать «онлайн»,
   * если админ реально не в чате. Потом — офлайн и оффер заявки.
   */
  offlineAfterVisitorSec: number;
  /** Текст после выбора «Дождаться ответа». */
  waitingReplyText: string;
  /** Цвет кнопки-иконки чата на сайте (#RRGGBB). */
  launcherColor: string;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  customChatEnabled: false,
  greetingText: CHAT_GREETING,
  greetingDelaySec: 15,
  offlineAfterVisitorSec: 60,
  waitingReplyText: "Хорошо, ответим в скором времени.",
  launcherColor: "#00b8f0",
};

/** Сообщение прочитано собеседником, если lastRead стоит на нём или позже. */
export function isMessageReadByPeer(
  messages: ChatMessage[],
  messageId: string,
  lastReadId: string | null | undefined
): boolean {
  if (!lastReadId || !messages.length) return false;
  const msgIdx = messages.findIndex((m) => m.id === messageId);
  const readIdx = messages.findIndex((m) => m.id === lastReadId);
  if (msgIdx < 0 || readIdx < 0) return false;
  return readIdx >= msgIdx;
}

export function countUnreadAfter(
  messages: ChatMessage[],
  lastReadId: string | null | undefined,
  role: ChatRole
): number {
  if (!messages.length) return 0;
  let start = 0;
  if (lastReadId) {
    const idx = messages.findIndex((m) => m.id === lastReadId);
    start = idx >= 0 ? idx + 1 : 0;
  }
  let n = 0;
  for (let i = start; i < messages.length; i += 1) {
    if (messages[i].role === role) n += 1;
  }
  return n;
}
