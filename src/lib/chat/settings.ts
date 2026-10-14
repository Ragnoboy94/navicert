import fs from "fs";
import path from "path";
import {
  DEFAULT_CHAT_SETTINGS,
  type ChatSettings,
} from "./types";

const STORE_PATH = path.join(process.cwd(), "data", "chat-settings.json");

function clampGreetingDelaySec(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CHAT_SETTINGS.greetingDelaySec;
  return Math.min(300, Math.max(3, Math.round(n)));
}

function clampOfflineAfterSec(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CHAT_SETTINGS.offlineAfterVisitorSec;
  return Math.min(600, Math.max(15, Math.round(n)));
}

function normalize(raw: Partial<ChatSettings> | null | undefined): ChatSettings {
  const text =
    typeof raw?.greetingText === "string" && raw.greetingText.trim()
      ? raw.greetingText.trim().slice(0, 500)
      : DEFAULT_CHAT_SETTINGS.greetingText;
  const waiting =
    typeof raw?.waitingReplyText === "string" && raw.waitingReplyText.trim()
      ? raw.waitingReplyText.trim().slice(0, 300)
      : DEFAULT_CHAT_SETTINGS.waitingReplyText;
  return {
    customChatEnabled: Boolean(raw?.customChatEnabled),
    greetingText: text,
    greetingDelaySec: clampGreetingDelaySec(raw?.greetingDelaySec),
    offlineAfterVisitorSec: clampOfflineAfterSec(raw?.offlineAfterVisitorSec),
    waitingReplyText: waiting,
  };
}

export function getChatSettings(): ChatSettings {
  try {
    if (!fs.existsSync(STORE_PATH)) return { ...DEFAULT_CHAT_SETTINGS };
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as Partial<ChatSettings>;
    return normalize(raw);
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS };
  }
}

export function saveChatSettings(
  input: Partial<ChatSettings>
): ChatSettings {
  const next = normalize({
    ...getChatSettings(),
    ...input,
  });
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
  fs.renameSync(tmp, STORE_PATH);
  return next;
}
