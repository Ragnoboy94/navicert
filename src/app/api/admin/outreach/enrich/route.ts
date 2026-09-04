import { NextResponse, after } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  getEnrichRunnerStatus,
  pauseBackgroundEnrich,
  resumeBackgroundEnrich,
} from "@/lib/outreach/enrich-runner";
import {
  cancelPendingEnrichJobs,
  enqueueFsaJob,
  getFsaQueueStatus,
  kickFsaDrain,
} from "@/lib/outreach/fsa-orchestrator";
import { readOutreachQueue } from "@/lib/outreach/queue";
import type { OutreachCategory } from "@/lib/outreach/types";
import { parseOutreachCategory } from "@/lib/outreach/category";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = parseOutreachCategory(url.searchParams.get("category"));
  return NextResponse.json({
    ...getEnrichRunnerStatus(category),
    fsaQueue: getFsaQueueStatus(category),
  });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const category = parseOutreachCategory(url.searchParams.get("category"));

  if (body.action === "stop") {
    pauseBackgroundEnrich(category);
    cancelPendingEnrichJobs(category);
    return NextResponse.json({
      ...getEnrichRunnerStatus(category),
      fsaQueue: getFsaQueueStatus(category),
    });
  }

  const queue = readOutreachQueue(category);
  if (!queue?.enrichQueue.length) {
    return NextResponse.json({
      ...getEnrichRunnerStatus(category),
      ok: true,
      message: "Очередь обогащения пуста",
      fsaQueue: getFsaQueueStatus(category),
    });
  }

  // «Продолжить» всегда снимает паузу — иначе задача в cron есть, а UI пишет «остановлено».
  resumeBackgroundEnrich(category);

  const queued = enqueueFsaJob({
    type: "enrich",
    category,
    priority: "low",
    source: "admin_enrich_button",
    // checko: 1–3 сессии; внутри сессии до ~12 карточек с паузами.
    payload: {
      maxBatches:
        category === "new_registrations" || category === "wb_sellers" ? 2 : 3,
    },
  });
  if (queued.accepted) {
    kickFsaDrain(category, 180_000);
    after(() => kickFsaDrain(category, 180_000));
  }
  const status = getEnrichRunnerStatus(category);
  const queueStatus = getFsaQueueStatus(category);

  return NextResponse.json({
    ...status,
    ok: true,
    // Реальный статус + факт постановки: UI сразу меняет кнопку.
    queued: Boolean(status.queued || status.running || queued.accepted),
    duplicate: queued.duplicate,
    started: false,
    alreadyRunning: status.running,
    pending: status.pending,
    message: queued.duplicate
      ? "Обработка email уже в очереди — ждём следующий запуск."
      : "Обработка email поставлена в очередь и уже запускается.",
    fsaQueue: queueStatus,
  });
}
