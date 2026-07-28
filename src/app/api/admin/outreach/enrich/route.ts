import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  getEnrichRunnerStatus,
  pauseBackgroundEnrich,
  startBackgroundEnrich,
} from "@/lib/outreach/enrich-runner";
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
  return NextResponse.json(getEnrichRunnerStatus(category));
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
    return NextResponse.json(getEnrichRunnerStatus(category));
  }

  const queue = readOutreachQueue(category);
  if (!queue?.enrichQueue.length) {
    return NextResponse.json({
      ...getEnrichRunnerStatus(category),
      ok: true,
      message: "Очередь обогащения пуста",
    });
  }

  const { started, alreadyRunning, paused: blockedByPause } =
    startBackgroundEnrich({
      force: Boolean(body.force),
      resetCounters: Boolean(body.resetCounters),
      category,
    });

  return NextResponse.json({
    ok: true,
    started,
    alreadyRunning,
    blockedByPause,
    ...getEnrichRunnerStatus(category),
  });
}
