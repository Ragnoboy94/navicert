import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { probeCheckoAccess } from "@/lib/outreach/checko-probe";

export async function POST(_request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const probe = await probeCheckoAccess();

  return NextResponse.json({
    ok: probe.ok,
    error: probe.error ?? null,
    message: probe.ok
      ? "Доступ к checko.ru подтверждён."
      : probe.error || "Нет доступа к checko.ru",
  });
}
