import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { enqueueFsaJob } from "@/lib/outreach/fsa-orchestrator";
import { readOutreachQueue } from "@/lib/outreach/queue";
import type { OutreachCategory } from "@/lib/outreach/types";

export const maxDuration = 300;

function parseCategory(raw: string | null | undefined): OutreachCategory {
  return raw === "expiring_certificates" ? "expiring_certificates" : "expiring";
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const category = parseCategory(body.category ?? url.searchParams.get("category"));
  const mode = body.mode === "append" ? "append" : "reset";
  const defaultMaxItems = mode === "append" ? 100 : 1000;
  const minItems = mode === "append" ? 10 : 50;
  const maxItems = Math.min(
    Math.max(Number(body.maxItems) || defaultMaxItems, minItems),
    1000
  );
  const pageSize = Math.min(Math.max(Number(body.pageSize) || 100, 10), 100);

  const existing = mode === "append" ? readOutreachQueue(category) : null;
  if (mode === "append" && !existing) {
    return NextResponse.json(
      { error: "Сначала выполните полную загрузку списка" },
      { status: 400 }
    );
  }

  const enqueued = enqueueFsaJob({
    type: "scan",
    category,
    priority: "high",
    source: "admin_scan_button",
    payload: { mode, maxItems, pageSize },
  });

  return NextResponse.json({
    ok: true,
    queued: true,
    duplicate: enqueued.duplicate,
    jobId: enqueued.jobId,
    message: enqueued.duplicate
      ? "Задача уже стоит в очереди. Когда очередь дойдёт, список обновится."
      : "Запрос добавлен в очередь. Данные подтянутся автоматически в ближайшем запуске cron.",
  });
}
