import { NextResponse } from "next/server";
import {
  getCategoryLabel,
  maskEmail,
  recordUnsubscribe,
  verifyUnsubscribeToken,
} from "@/lib/outreach/unsubscribe";

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
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? "").trim();
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
