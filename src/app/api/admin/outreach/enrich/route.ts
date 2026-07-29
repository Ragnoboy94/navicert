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

function parseCategory(raw: string | null): OutreachCategory {
  return raw === "expiring_certificates" ? "expiring_certificates" : "expiring";
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = parseCategory(url.searchParams.get("category"));
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
  const category = parseCategory(url.searchParams.get("category"));

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
    payload: { maxBatches: 3 },
  });
  if (queued.accepted) {
    after(() => kickFsaDrain(category, 180_000));
  }
  const status = getEnrichRunnerStatus(category);
  const queueStatus = getFsaQueueStatus(category);

  return NextResponse.json({
    ...status,
    ok: true,
    queued: true,
    duplicate: queued.duplicate,
    started: false,
    alreadyRunning: status.running,
    message: queued.duplicate
      ? "Обработка email уже в очереди — ждём следующий запуск."
      : "Обработка email поставлена в очередь и уже запускается.",
    fsaQueue: queueStatus,
  });
}
