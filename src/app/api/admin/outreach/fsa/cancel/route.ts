import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  cancelPendingFsaJobs,
  getFsaQueueStatus,
} from "@/lib/outreach/fsa-orchestrator";
import { pauseBackgroundEnrich } from "@/lib/outreach/enrich-runner";
import type { OutreachCategory } from "@/lib/outreach/types";

function parseCategory(raw: string | null | undefined): OutreachCategory {
  return raw === "expiring_certificates" ? "expiring_certificates" : "expiring";
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const category = parseCategory(
    body.category ?? url.searchParams.get("category")
  );

  const scope =
    body.scope === "enrich" || body.scope === "scan" ? body.scope : "all";
  const types =
    scope === "enrich"
      ? (["enrich"] as const)
      : scope === "scan"
        ? (["scan"] as const)
        : (["scan", "enrich", "health"] as const);

  // Паузу ставим только при явной отмене enrich.
  // «Очистить очередь» не должна навсегда глушить фоновое обогащение.
  if (scope === "enrich") {
    pauseBackgroundEnrich(category);
  }

  const cancelled = cancelPendingFsaJobs(category, [...types]);

  return NextResponse.json({
    ok: true,
    cancelled,
    message:
      cancelled > 0
        ? `Снято с очереди: ${cancelled}`
        : "В очереди не было задач",
    fsaQueue: getFsaQueueStatus(category),
  });
}
