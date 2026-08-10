import { NextResponse, after } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  enqueueFsaJob,
  getFsaQueueStatus,
  kickFsaDrain,
} from "@/lib/outreach/fsa-orchestrator";
import { readOutreachQueue } from "@/lib/outreach/queue";
import type { OutreachCategory } from "@/lib/outreach/types";
import { parseOutreachCategory } from "@/lib/outreach/category";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const category = parseOutreachCategory(body.category ?? url.searchParams.get("category"));
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

  if (!enqueued.accepted) {
    return NextResponse.json(
      {
        ok: false,
        queued: false,
        duplicate: true,
        pendingAppendScans: enqueued.pendingAppendScans ?? 0,
        fsaQueue: getFsaQueueStatus(category),
        error:
          enqueued.rejectedReason ||
          (mode === "append"
            ? `Уже стоит ${enqueued.pendingAppendScans ?? 0} догрузок в очереди (лимит). Дождитесь cron или очистите очередь.`
            : "Задача уже в очереди"),
      },
      { status: 409 }
    );
  }

  const pendingAppend =
    enqueued.pendingAppendScans ??
    (mode === "append" ? 1 : 0);

  // Сразу пнуть drain (не ждать after / cron).
  kickFsaDrain(category, 180_000);
  after(() => kickFsaDrain(category, 180_000));

  return NextResponse.json({
    ok: true,
    queued: true,
    duplicate: enqueued.duplicate,
    jobId: enqueued.jobId,
    pendingAppendScans: pendingAppend,
    fsaQueue: getFsaQueueStatus(category),
    message: enqueued.duplicate
      ? mode === "reset"
        ? "Полная загрузка уже стоит в очереди."
        : "Задача уже стоит в очереди. Когда очередь дойдёт, список обновится."
      : mode === "append"
        ? `В очередь: +${maxItems} (догрузок: ${pendingAppend}). Обработка уже запускается.`
        : "Запрос добавлен в очередь — обработка уже запускается.",
  });
}
