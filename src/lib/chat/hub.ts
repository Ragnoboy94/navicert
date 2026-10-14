import { EventEmitter } from "events";
import type { ChatMessage, ChatThreadSummary } from "./types";

export type ChatHubMessageEvent = {
  type: "message";
  visitorId: string;
  message: ChatMessage;
  thread: ChatThreadSummary;
};

export type ChatHubThreadEvent = {
  type: "thread_upsert";
  thread: ChatThreadSummary;
};

const globalKey = "__navicert_chat_hub__";

export const chatHub: EventEmitter =
  ((globalThis as Record<string, unknown>)[globalKey] as EventEmitter | undefined) ??
  new EventEmitter();

chatHub.setMaxListeners(50);
(globalThis as Record<string, unknown>)[globalKey] = chatHub;
