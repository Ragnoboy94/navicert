import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  ChatMessage,
  ChatRole,
  ChatThread,
  ChatThreadSummary,
} from "./types";
import { touchAgentPresence } from "./agent-presence";
import { getChatSettings } from "./settings";
import { countUnreadAfter } from "./types";
import { chatHub } from "./hub";
import { notifyAdminsChatPush } from "./push";

const STORE_PATH = path.join(process.cwd(), "data", "chat-threads.json");

type ChatStoreFile = {
  threads: ChatThread[];
};

function emptyStore(): ChatStoreFile {
  return { threads: [] };
}

function normalizeThread(raw: ChatThread): ChatThread {
  return {
    ...raw,
    unreadByAdmin: raw.unreadByAdmin ?? 0,
    favorited: Boolean(raw.favorited),
    visitorName: raw.visitorName?.trim() || null,
    visitorPhone: raw.visitorPhone?.trim() || null,
    leadId: raw.leadId?.trim() || null,
    lastReadByVisitor: raw.lastReadByVisitor ?? null,
    lastReadByAdmin: raw.lastReadByAdmin ?? null,
    messages: Array.isArray(raw.messages) ? raw.messages : [],
  };
}

function readStore(): ChatStoreFile {
  try {
    if (!fs.existsSync(STORE_PATH)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as ChatStoreFile;
    if (!Array.isArray(raw.threads)) return emptyStore();
    return { threads: raw.threads.map((t) => normalizeThread(t)) };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: ChatStoreFile): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
  fs.renameSync(tmp, STORE_PATH);
}

/** Обычное сообщение посетителя (не служебное adminOnly). */
export function threadHasVisitorMessage(thread: ChatThread): boolean {
  return thread.messages.some((m) => m.role === "visitor" && !m.adminOnly);
}

function buildSearchText(thread: ChatThread): string {
  const parts = [
    thread.visitorName,
    thread.visitorPhone,
    thread.visitorId,
    ...thread.messages.map((m) => m.text),
  ];
  return parts
    .filter((p): p is string => Boolean(p && String(p).trim()))
    .join("\n")
    .toLowerCase();
}

function summarize(thread: ChatThread): ChatThreadSummary {
  const last = thread.messages[thread.messages.length - 1];
  return {
    id: thread.id,
    visitorId: thread.visitorId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessageAt: thread.lastMessageAt,
    greeted: thread.greeted,
    unreadByAdmin: thread.unreadByAdmin,
    favorited: thread.favorited,
    visitorName: thread.visitorName,
    visitorPhone: thread.visitorPhone,
    leadId: thread.leadId,
    lastReadByVisitor: thread.lastReadByVisitor,
    lastReadByAdmin: thread.lastReadByAdmin,
    preview: last?.text?.slice(0, 120) || "",
    messageCount: thread.messages.length,
    hasVisitorMessage: threadHasVisitorMessage(thread),
    searchText: buildSearchText(thread),
  };
}

function newThread(visitorId: string): ChatThread {
  const now = new Date().toISOString();
  return {
    id: visitorId,
    visitorId,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    greeted: false,
    unreadByAdmin: 0,
    favorited: false,
    visitorName: null,
    visitorPhone: null,
    leadId: null,
    lastReadByVisitor: null,
    lastReadByAdmin: null,
    messages: [],
  };
}

function recomputeUnreadByAdmin(thread: ChatThread): void {
  thread.unreadByAdmin = countUnreadAfter(
    thread.messages,
    thread.lastReadByAdmin,
    "visitor"
  );
}

export function listChatThreads(): ChatThreadSummary[] {
  return readStore()
    .threads.filter(threadHasVisitorMessage)
    .map(summarize)
    .sort((a, b) => {
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
}

/** Задать / сбросить отображаемое имя (пустая строка → снова код посетителя). */
export function renameChatThread(
  visitorId: string,
  name: string
): ChatThread | null {
  const store = readStore();
  const thread = store.threads.find((t) => t.visitorId === visitorId.trim());
  if (!thread) return null;
  const trimmed = name.trim().slice(0, 120);
  thread.visitorName = trimmed || null;
  thread.updatedAt = new Date().toISOString();
  writeStore(store);
  chatHub.emit("thread", {
    type: "thread_upsert",
    thread: summarize(thread),
  });
  return thread;
}

/** Переключить избранное. */
export function toggleThreadFavorite(
  visitorId: string
): ChatThread | null {
  const store = readStore();
  const thread = store.threads.find((t) => t.visitorId === visitorId.trim());
  if (!thread) return null;
  thread.favorited = !thread.favorited;
  thread.updatedAt = new Date().toISOString();
  writeStore(store);
  chatHub.emit("thread", {
    type: "thread_upsert",
    thread: summarize(thread),
  });
  return thread;
}

export function getChatThread(visitorId: string): ChatThread | null {
  const id = visitorId.trim();
  if (!id) return null;
  return readStore().threads.find((t) => t.visitorId === id) ?? null;
}

export function ensureChatThread(visitorId: string): ChatThread {
  const id = visitorId.trim();
  if (!id) throw new Error("visitorId_required");

  const store = readStore();
  const existing = store.threads.find((t) => t.visitorId === id);
  if (existing) return existing;

  const thread = newThread(id);
  store.threads.push(thread);
  writeStore(store);
  chatHub.emit("thread", { type: "thread_upsert", thread: summarize(thread) });
  return thread;
}

function appendMessage(
  visitorId: string,
  role: ChatRole,
  text: string,
  opts?: { markGreeted?: boolean; adminOnly?: boolean }
): { thread: ChatThread; message: ChatMessage } {
  const trimmed = text.trim().slice(0, 4000);
  if (!trimmed) throw new Error("empty_message");

  const store = readStore();
  let thread = store.threads.find((t) => t.visitorId === visitorId);
  if (!thread) {
    thread = newThread(visitorId);
    store.threads.push(thread);
  }

  const message: ChatMessage = {
    id: randomUUID(),
    role,
    text: trimmed,
    createdAt: new Date().toISOString(),
    ...(opts?.adminOnly ? { adminOnly: true } : {}),
  };
  thread.messages.push(message);
  thread.updatedAt = message.createdAt;
  thread.lastMessageAt = message.createdAt;
  if (opts?.markGreeted) thread.greeted = true;

  // Отправитель уже «видит» свой чат до этого сообщения.
  if (role === "visitor") thread.lastReadByVisitor = message.id;
  if (role === "agent") {
    thread.lastReadByAdmin = message.id;
    touchAgentPresence();
  }

  recomputeUnreadByAdmin(thread);

  writeStore(store);
  chatHub.emit("message", {
    type: "message",
    visitorId,
    message,
    thread: summarize(thread),
  });
  chatHub.emit("thread", { type: "thread_upsert", thread: summarize(thread) });

  // Push админам (PWA); служебные adminOnly (заявка) не пушим.
  if (role === "visitor" && !opts?.adminOnly) {
    void notifyAdminsChatPush({
      title: "Нависерт — чат",
      body: trimmed,
      url: `/admin?section=chat`,
    }).catch((err) => console.warn("[push] notify failed", err));
  }

  return { thread, message };
}

export function addVisitorMessage(visitorId: string, text: string) {
  return appendMessage(visitorId.trim(), "visitor", text);
}

export function addAgentMessage(visitorId: string, text: string) {
  return appendMessage(visitorId.trim(), "agent", text);
}

/** Привязать заявку из чата: имя/телефон в тред + сообщение с путём квиза. */
export function attachLeadToChatThread(input: {
  visitorId: string;
  name: string;
  phone: string;
  leadId: string;
  /** Текст как в заявке: результат + путь */
  summaryText: string;
}): { thread: ChatThread; message: ChatMessage } {
  const visitorId = input.visitorId.trim();
  const name = input.name.trim().slice(0, 120);
  const phone = input.phone.trim().slice(0, 40);
  const leadId = input.leadId.trim().slice(0, 80);
  const summary = input.summaryText.trim().slice(0, 3500);
  if (!visitorId || !name || !phone || !leadId || !summary) {
    throw new Error("lead_attach_invalid");
  }

  ensureChatThread(visitorId);

  const store = readStore();
  const thread = store.threads.find((t) => t.visitorId === visitorId);
  if (!thread) throw new Error("thread_missing");

  const existingName = thread.visitorName?.trim() || "";
  thread.visitorName = existingName ? `${existingName} (${name})` : name;
  thread.visitorPhone = phone;
  thread.leadId = leadId;
  thread.updatedAt = new Date().toISOString();
  writeStore(store);
  chatHub.emit("thread", { type: "thread_upsert", thread: summarize(thread) });

  const body = [
    "📋 Заявка оформлена",
    "",
    thread.visitorName,
    phone,
    "",
    summary,
  ].join("\n");

  return appendMessage(visitorId, "visitor", body, { adminOnly: true });
}

const greetingInFlight = new Set<string>();

export function ensureGreeting(visitorId: string): {
  thread: ChatThread;
  message: ChatMessage | null;
  created: boolean;
} {
  const id = visitorId.trim();
  if (!id) throw new Error("visitorId_required");

  if (greetingInFlight.has(id)) {
    const thread = getChatThread(id) ?? ensureChatThread(id);
    return { thread, message: null, created: false };
  }

  greetingInFlight.add(id);
  try {
    const thread = ensureChatThread(id);
    if (thread.greeted) {
      return { thread, message: null, created: false };
    }
    const greeting = getChatSettings().greetingText;
    const { thread: next, message } = appendMessage(id, "agent", greeting, {
      markGreeted: true,
    });
    return { thread: next, message, created: true };
  } finally {
    greetingInFlight.delete(id);
  }
}

function advanceLastRead(
  thread: ChatThread,
  field: "lastReadByVisitor" | "lastReadByAdmin"
): boolean {
  const last = thread.messages[thread.messages.length - 1];
  if (!last) return false;
  if (thread[field] === last.id) return false;
  thread[field] = last.id;
  thread.updatedAt = new Date().toISOString();
  return true;
}

function emitRead(visitorId: string, thread: ChatThread, asAdmin: boolean) {
  const summary = summarize(thread);
  // Через канал message — доходит и посетителю, и админу (уже работает в WS).
  chatHub.emit("message", {
    type: "read",
    visitorId,
    thread: summary,
    // Админ прочитал = он сейчас у монитора.
    ...(asAdmin ? { agentOnline: true } : {}),
  });
  chatHub.emit("thread", { type: "thread_upsert", thread: summary });
}

/** Посетитель открыл виджет — все текущие сообщения прочитаны. */
export function markReadByVisitor(visitorId: string): ChatThread | null {
  const store = readStore();
  const thread = store.threads.find((t) => t.visitorId === visitorId.trim());
  if (!thread) return null;
  if (!advanceLastRead(thread, "lastReadByVisitor")) return thread;
  writeStore(store);
  emitRead(visitorId.trim(), thread, false);
  return thread;
}

/** Админ открыл диалог — все текущие сообщения прочитаны. */
export function markReadByAdmin(visitorId: string): ChatThread | null {
  // Любое действие админа в диалоге = он онлайн для посетителя.
  touchAgentPresence();

  const store = readStore();
  const thread = store.threads.find((t) => t.visitorId === visitorId.trim());
  if (!thread) return null;
  const advanced = advanceLastRead(thread, "lastReadByAdmin");
  const prevUnread = thread.unreadByAdmin;
  recomputeUnreadByAdmin(thread);
  if (!advanced && prevUnread === thread.unreadByAdmin) {
    // Курсор не сдвинулся, но touchAgentPresence уже пушнул online в виджет.
    return thread;
  }
  thread.updatedAt = new Date().toISOString();
  writeStore(store);
  emitRead(visitorId.trim(), thread, true);
  return thread;
}

/** @deprecated используйте markReadByAdmin */
export function markThreadRead(visitorId: string): ChatThread | null {
  return markReadByAdmin(visitorId);
}
