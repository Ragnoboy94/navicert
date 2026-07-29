import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { probeFsaTransport } from "@/lib/outreach/fsa-network";

export async function POST(_request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const probe = await probeFsaTransport();

  return NextResponse.json({
    ok: probe.ok,
    mode: probe.mode,
    proxy: probe.proxy ?? null,
    error: probe.error ?? null,
    message: probe.ok
      ? "Доступ к ФСА подтверждён."
      : `Нет доступа к ФСА: ${probe.error || "проверьте соединение"}`,
  });
}

