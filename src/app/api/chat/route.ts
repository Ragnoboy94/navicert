import { NextResponse } from "next/server";
import {
  addVisitorMessage,
  attachLeadToChatThread,
  ensureChatThread,
  ensureGreeting,
  getChatThread,
  markReadByVisitor,
} from "@/lib/chat/store";

function badRequest(reason: string, status = 400) {
  return NextResponse.json({ ok: false, reason }, { status });
}

/** Получить/создать тред посетителя */
export async function GET(request: Request) {
  const visitorId = new URL(request.url).searchParams.get("visitorId")?.trim();
  if (!visitorId) return badRequest("visitorId_required");
  if (visitorId.length > 80) return badRequest("visitorId_invalid");

  const thread = ensureChatThread(visitorId);
  return NextResponse.json({ ok: true, thread });
}

/**
 * action:
 * - message — сообщение посетителя { visitorId, text }
 * - greet — автопривет через ~15с { visitorId }
 * - read — посетитель открыл чат { visitorId }
 * - attach_lead — заявка из офлайн-чата { visitorId, name, phone, leadId, summaryText }
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    visitorId?: string;
    text?: string;
    name?: string;
    phone?: string;
    leadId?: string;
    summaryText?: string;
  } | null;

  if (!body) return badRequest("invalid_json");
  const visitorId = body.visitorId?.trim() || "";
  if (!visitorId || visitorId.length > 80) return badRequest("visitorId_required");

  if (body.action === "greet") {
    const result = ensureGreeting(visitorId);
    return NextResponse.json({
      ok: true,
      created: result.created,
      thread: result.thread,
      message: result.message,
    });
  }

  if (body.action === "read") {
    const thread = markReadByVisitor(visitorId) ?? ensureChatThread(visitorId);
    return NextResponse.json({ ok: true, thread });
  }

  if (body.action === "attach_lead") {
    try {
      const { thread, message } = attachLeadToChatThread({
        visitorId,
        name: body.name || "",
        phone: body.phone || "",
        leadId: body.leadId || "",
        summaryText: body.summaryText || "",
      });
      return NextResponse.json({ ok: true, thread, message });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "attach_failed";
      return badRequest(reason);
    }
  }

  if (body.action === "message" || !body.action) {
    const text = body.text?.trim() || "";
    if (!text) return badRequest("empty_message");
    try {
      const { thread, message } = addVisitorMessage(visitorId, text);
      return NextResponse.json({ ok: true, thread, message });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "send_failed";
      return badRequest(reason);
    }
  }

  return badRequest("unknown_action");
}

/** Для отладки: убедиться, что тред читается */
export async function HEAD(request: Request) {
  const visitorId = new URL(request.url).searchParams.get("visitorId")?.trim();
  if (!visitorId) return new NextResponse(null, { status: 400 });
  const thread = getChatThread(visitorId);
  return new NextResponse(null, { status: thread ? 200 : 404 });
}
