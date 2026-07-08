import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  getEnrichRunnerStatus,
  pauseBackgroundEnrich,
  startBackgroundEnrich,
} from "@/lib/outreach/enrich-runner";
import { readOutreachQueue } from "@/lib/outreach/queue";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(getEnrichRunnerStatus());
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  if (body.action === "stop") {
    pauseBackgroundEnrich();
    return NextResponse.json(getEnrichRunnerStatus());
  }

  const queue = readOutreachQueue();
  if (!queue?.enrichQueue.length) {
    return NextResponse.json({
      ...getEnrichRunnerStatus(),
      ok: true,
      message: "Очередь обогащения пуста",
    });
  }

  const { started, alreadyRunning, paused: blockedByPause } =
    startBackgroundEnrich({
      force: Boolean(body.force),
      resetCounters: Boolean(body.resetCounters),
    });

  return NextResponse.json({
    ok: true,
    started,
    alreadyRunning,
    blockedByPause,
    ...getEnrichRunnerStatus(),
  });
}
