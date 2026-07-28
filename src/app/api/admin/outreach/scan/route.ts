import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  bulkLoadList,
  listResultToQueue,
} from "@/lib/outreach/bulk-load";
import { formatFsaConnectionError } from "@/lib/outreach/fsa-connection";
import { startBackgroundEnrich } from "@/lib/outreach/enrich-runner";
import { readOutreachQueue, writeOutreachQueue } from "@/lib/outreach/queue";
import type { OutreachCategory } from "@/lib/outreach/types";

export const maxDuration = 300;

function parseCategory(raw: string | null | undefined): OutreachCategory {
  return raw === "expiring_certificates" ? "expiring_certificates" : "expiring";
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    const result = await bulkLoadList({
      mode,
      maxItems,
      pageSize,
      existingQueue: existing,
      // append держит текущий range; reset берёт свежую формулу в bulkLoadList
      range: mode === "append" ? existing?.range : undefined,
      category,
    });

    writeOutreachQueue(
      listResultToQueue(result, { mode, existing: existing ?? undefined, category })
    );

    if (result.enrichQueue.length > 0) {
      const queue = readOutreachQueue(category);
      if (!queue?.enrichPaused) {
        startBackgroundEnrich({ resetCounters: mode === "reset", category });
      }
    }

    return NextResponse.json({
      ok: true,
      mode,
      loadedFromApi: result.loadedFromApi,
      addedNew: result.addedNew,
      emailsFromList: result.emailsFromList,
      enrichPending: result.enrichQueue.length,
      eligible: result.items.length,
      rejected: result.rejected.length,
      hasMore: result.hasMore,
      nextApiPage: result.nextApiPage,
      apiCursor: result.apiCursor,
      cursorLabel: result.cursorLabel,
      range: result.range,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: formatFsaConnectionError(error),
      },
      { status: 500 }
    );
  }
}
