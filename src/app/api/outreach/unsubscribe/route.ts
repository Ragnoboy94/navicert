import { NextResponse } from "next/server";
import {
  getCategoryLabel,
  maskEmail,
  recordUnsubscribe,
  verifyUnsubscribeToken,
} from "@/lib/outreach/unsubscribe";

async function resolveToken(request: Request): Promise<string> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token")?.trim();
  if (fromQuery) return fromQuery;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return String((body as { token?: string }).token ?? "").trim();
  }

  const raw = await request.text().catch(() => "");
  if (
    raw.includes("List-Unsubscribe=One-Click") ||
    request.headers.get("List-Unsubscribe") === "One-Click"
  ) {
    return "";
  }

  return "";
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Токен не указан" }, { status: 400 });
  }

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Ссылка недействительна" }, { status: 400 });
  }

  return NextResponse.json({
    valid: true,
    emailMasked: maskEmail(payload.email),
    category: payload.category,
    categoryLabel: getCategoryLabel(payload.category),
    companyName: payload.companyName ?? null,
  });
}

export async function POST(request: Request) {
  const token = await resolveToken(request);
  if (!token) {
    return NextResponse.json({ error: "Токен не указан" }, { status: 400 });
  }

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Ссылка недействительна" }, { status: 400 });
  }

  const record = recordUnsubscribe(payload);

  return NextResponse.json({
    ok: true,
    categoryLabel: getCategoryLabel(payload.category),
    emailMasked: maskEmail(payload.email),
    unsubscribedAt: record.unsubscribedAt,
  });
}
