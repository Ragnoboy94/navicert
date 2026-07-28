import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { clampBatchCount } from "@/lib/outreach/limits";
import { sendOutreachBatch, sendOutreachEmail } from "@/lib/outreach/mailer";
import { readOutreachQueue } from "@/lib/outreach/queue";
import {
  formatEmptySendMessage,
  pickSendableCandidates,
  summarizeSendBlocks,
} from "@/lib/outreach/send-selection";
import type { FsaDeclaration, OutreachQueueItem, OutreachCategory } from "@/lib/outreach/types";

export const maxDuration = 300;

function parseCategory(raw: string | null | undefined): OutreachCategory {
  return raw === "expiring_certificates"
    ? "expiring_certificates"
    : "expiring";
}

function findQueueItem(
  queue: NonNullable<ReturnType<typeof readOutreachQueue>>,
  id: number
): OutreachQueueItem | undefined {
  return (
    queue.items.find((item) => item.id === id) ??
    queue.rejected.find((item) => item.id === id)
  );
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const url = new URL(request.url);
    const category = parseCategory(body.category ?? url.searchParams.get("category"));
    const count = clampBatchCount(body.count);
    const force = Boolean(body.force);
    const manual = Boolean(body.manual);
    const ids = Array.isArray(body.ids)
      ? body.ids.map((id: unknown) => Number(id)).filter(Boolean)
      : null;

    const queue = readOutreachQueue(category);
    if (!queue?.items?.length && !queue?.rejected?.length) {
      return NextResponse.json(
        { error: "Сначала обновите список из реестра ФСА" },
        { status: 400 }
      );
    }

    let pool: FsaDeclaration[] = [];

    if (ids?.length) {
      for (const id of ids) {
        const item = findQueueItem(queue, id);
        if (item) pool.push(item);
      }
    } else {
      pool = queue.items;
    }

    if (manual && ids?.length === 1) {
      const item = findQueueItem(queue, ids[0]);
      if (!item) {
        return NextResponse.json(
          {
            error:
              category === "expiring_certificates"
                ? "Сертификат не найден"
                : "Декларация не найдена",
          },
          { status: 404 }
        );
      }
      const result = await sendOutreachEmail(item, {
        force,
        manual: true,
        category,
      });
      return NextResponse.json({
        ok: result.ok,
        sent: result.ok ? 1 : 0,
        results: [
          {
            id: item.id,
            ok: result.ok,
            reason: result.ok ? undefined : result.reason,
            record: result.ok ? result.record : undefined,
          },
        ],
      });
    }

    const toSend = pickSendableCandidates(pool, {
      force,
      manual,
      forAutoSend: !manual,
      limit: count,
      // category прокидывается на блокировки/отписки
      category,
    });

    if (toSend.length === 0) {
      const summary = summarizeSendBlocks(pool, { category });
      return NextResponse.json(
        {
          error: formatEmptySendMessage(summary, { category }),
          summary,
        },
        { status: 400 }
      );
    }

    const { results, emailValidation } = await sendOutreachBatch(toSend, {
      force,
      manual,
      category,
    });

    return NextResponse.json({
      ok: true,
      sent: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok),
      results,
      emailValidation,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось отправить письма",
      },
      { status: 500 }
    );
  }
}
