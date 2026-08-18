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
  "new_registrations",
];

async function runCategoryCron(category: OutreachCategory, maxMs: number) {
  const startedAt = Date.now();
  const schedule = readOutreachSchedule(category);
  const stats = getScheduleStats(category);

  // Сначала автоотправка — не блокируем её drain/enrich (на проде cron зависал >4 мин).
  const send = await runScheduledOutreach({ category });

  const elapsedAfterSend = Date.now() - startedAt;
  const remainingMs = Math.max(maxMs - elapsedAfterSend, 0);

  // После send — только короткое обслуживание; тяжёлые scan/enrich не ждём.
  const maintenance =
    remainingMs > 8_000
      ? await runCronMaintenance({
          category,
          maxMs: Math.min(remainingMs - 2_000, 45_000),
        })
      : { morningSync: { ran: false, reason: "time_budget" }, hourlyAppend: { ran: false, reason: "time_budget" }, enrich: { ran: false, processed: 0, emailsFound: 0, enrichPending: 0 }, queueReady: 0 };

  const topUp =
    schedule.enabled && remainingMs > 5_000
      ? await ensureQueueForScheduledSend(stats.perRunLimit, category)
      : null;

  const drainBudget = Math.min(Math.floor(remainingMs * 0.25), 12_000);
  const drainedAfter =
    drainBudget >= 3_000
      ? await drainFsaJobs({ category, maxMs: drainBudget })
      : { ran: 0, ok: 0, failed: 0 };

  return {
    category,
    fsaQueue: {
      before: { ran: 0, ok: 0, failed: 0 },
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
