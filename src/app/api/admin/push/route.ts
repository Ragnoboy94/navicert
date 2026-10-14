import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  getVapidPublicKey,
  removePushSubscription,
  savePushSubscription,
  type PushSubscriptionJSON,
} from "@/lib/chat/push";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Публичный VAPID-ключ для подписки в браузере. */
export async function GET() {
  if (!(await isAuthenticated())) return unauthorized();
  return NextResponse.json({
    ok: true,
    publicKey: getVapidPublicKey(),
  });
}

/** Сохранить подписку на пуши. */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();

  const body = (await request.json().catch(() => null)) as {
    subscription?: PushSubscriptionJSON;
  } | null;

  if (!body?.subscription) {
    return NextResponse.json({ error: "subscription_required" }, { status: 400 });
  }

  try {
    savePushSubscription(body.subscription);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }
}

/** Удалить подписку. */
export async function DELETE(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();

  const body = (await request.json().catch(() => null)) as {
    endpoint?: string;
  } | null;

  if (!body?.endpoint?.trim()) {
    return NextResponse.json({ error: "endpoint_required" }, { status: 400 });
  }

  removePushSubscription(body.endpoint.trim());
  return NextResponse.json({ ok: true });
}
