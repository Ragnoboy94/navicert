import { NextResponse } from "next/server";
import {
  ensureQueueForScheduledSend,
  runCronMaintenance,
} from "@/lib/outreach/cron-maintenance";
import { drainFsaJobs } from "@/lib/outreach/fsa-orchestrator";
import {
  getScheduleStats,
  readOutreachSchedule,
  runScheduledOutreach,
  verifyCronSecret,
} from "@/lib/outreach/schedule";
import type { OutreachCategory } from "@/lib/outreach/types";

export const maxDuration = 300;

const CRON_CATEGORIES: OutreachCategory[] = [
  "expiring",
  "expiring_certificates",
];

async function runCategoryCron(category: OutreachCategory, maxMs: number) {
  const drainedBefore = await drainFsaJobs({
    category,
    maxMs: Math.min(Math.floor(maxMs * 0.35), 60_000),
  });
  const maintenance = await runCronMaintenance({ maxMs, category });

  const schedule = readOutreachSchedule(category);
  const stats = getScheduleStats(category);
  const topUp =
    schedule.enabled
      ? await ensureQueueForScheduledSend(stats.perRunLimit, category)
      : null;

  const send = await runScheduledOutreach({ category });
  const drainedAfter = await drainFsaJobs({
    category,
    maxMs: Math.min(Math.floor(maxMs * 0.35), 60_000),
  });

  return {
    category,
    fsaQueue: {
      before: drainedBefore,
      after: drainedAfter,
    },
    maintenance,
    topUp,
    send,
    stats: getScheduleStats(category),
  };
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const startedAt = Date.now();
    const totalBudgetMs = 240_000;
    const results = [];

    for (const category of CRON_CATEGORIES) {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(totalBudgetMs - elapsed, 0);
      if (remaining < 5_000) {
        results.push({
          category,
          skipped: true,
          reason: "time_budget_exhausted",
        });
        continue;
      }

      // Делим оставшийся бюджет поровну между ещё не обработанными категориями
      const left = CRON_CATEGORIES.length - results.length;
      const categoryBudget = Math.floor(remaining / left);
      results.push(await runCategoryCron(category, categoryBudget));
    }

    return NextResponse.json({
      results,
      // Совместимость со старым ответом: первый контур (декларации)
      maintenance: results[0] && "maintenance" in results[0] ? results[0].maintenance : null,
      topUp: results[0] && "topUp" in results[0] ? results[0].topUp : null,
      send: results[0] && "send" in results[0] ? results[0].send : null,
      stats: results[0] && "stats" in results[0] ? results[0].stats : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось выполнить задачу cron",
      },
      { status: 500 }
    );
  }
}
