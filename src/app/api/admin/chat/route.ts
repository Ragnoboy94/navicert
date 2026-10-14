import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getChatSettings, saveChatSettings } from "@/lib/chat/settings";
import {
  addAgentMessage,
  getChatThread,
  listChatThreads,
  markReadByAdmin,
  toggleThreadFavorite,
} from "@/lib/chat/store";
import type { ChatSettings } from "@/lib/chat/types";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();

  const url = new URL(request.url);
  if (url.searchParams.get("settings") === "1") {
    return NextResponse.json({ ok: true, settings: getChatSettings() });
  }

  const visitorId = url.searchParams.get("visitorId")?.trim();
  if (visitorId) {
    const thread = getChatThread(visitorId);
    if (!thread) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Прочитано только по действию (мышь/клавиша), не при открытии списка.
    return NextResponse.json({ ok: true, thread });
  }

  return NextResponse.json({
    ok: true,
    threads: listChatThreads(),
    settings: getChatSettings(),
  });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    visitorId?: string;
    text?: string;
    settings?: Partial<ChatSettings>;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.action === "settings") {
    const settings = saveChatSettings(body.settings || {});
    return NextResponse.json({ ok: true, settings });
  }

  if (!body.visitorId?.trim()) {
    return NextResponse.json({ error: "visitorId_required" }, { status: 400 });
  }

  const visitorId = body.visitorId.trim();

  if (body.action === "read") {
    const thread = markReadByAdmin(visitorId);
    return NextResponse.json({ ok: true, thread });
  }

  if (body.action === "favorite") {
    const thread = toggleThreadFavorite(visitorId);
    if (!thread) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, thread });
  }

  const text = body.text?.trim() || "";
  if (!text) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  try {
    const { thread, message } = addAgentMessage(visitorId, text);
    return NextResponse.json({ ok: true, thread, message });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "send_failed";
    return NextResponse.json({ error: reason }, { status: 400 });
  }
}
