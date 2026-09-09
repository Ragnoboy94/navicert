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
  const dailyScan = Boolean(body.dailyScan);
  const scanDayRaw = typeof body.scanDay === "string" ? body.scanDay.trim() : "";
  const scanDay =
    dailyScan && /^\d{4}-\d{2}-\d{2}$/.test(scanDayRaw) ? scanDayRaw : undefined;
  const todayOnly = Boolean(body.todayOnly) && dailyScan && !scanDay;
  const dayScan = Boolean(scanDay || todayOnly);
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

  if (dayScan && category !== "new_registrations") {
    return NextResponse.json(
      { error: "Загрузка за день доступна только для новых организаций" },
      { status: 400 }
    );
  }

  const enqueued = enqueueFsaJob({
    type: "scan",
    category,
    priority: "high",
    source: dayScan ? "admin_scan_day" : "admin_scan_button",
    payload: {
      mode,
      maxItems,
      pageSize,
      ...(dailyScan ? { dailyScan: true } : {}),
      ...(todayOnly ? { todayOnly: true } : {}),
      ...(scanDay ? { scanDay } : {}),
    },
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

  const dayLabel = scanDay
    ? (() => {
        const m = scanDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}.${m[2]}.${m[1]}` : scanDay;
      })()
    : null;

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
      : dayScan
        ? dayLabel
          ? `Принято: загрузка новых организаций за ${dayLabel}.`
          : "Принято: загрузка новых организаций за сегодня."
        : mode === "append"
          ? `В очередь: +${maxItems} (догрузок: ${pendingAppend}). Обработка уже запускается.`
          : "Запрос добавлен в очередь — обработка уже запускается.",
  });
}
