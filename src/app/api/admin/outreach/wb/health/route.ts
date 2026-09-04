import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { probeWbAccess } from "@/lib/outreach/wb-sellers";

export async function POST(_request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const probe = await probeWbAccess();

  return NextResponse.json({
    ok: probe.ok,
    error: probe.error ?? null,
    message: probe.ok
      ? "Доступ к Wildberries подтверждён."
      : probe.error || "Нет доступа к Wildberries",
  });
}
