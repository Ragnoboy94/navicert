import { NextResponse } from "next/server";
import {
  ensureQueueForScheduledSend,
  runCronMaintenance,
} from "@/lib/outreach/cron-maintenance";
import {
  getScheduleStats,
  readOutreachSchedule,
  runScheduledOutreach,
  verifyCronSecret,
} from "@/lib/outreach/schedule";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const maintenance = await runCronMaintenance({ maxMs: 240_000 });

    const schedule = readOutreachSchedule();
    const stats = getScheduleStats(schedule);
    const topUp =
      schedule.enabled
        ? await ensureQueueForScheduledSend(stats.perRunLimit)
        : null;

    const send = await runScheduledOutreach();

    return NextResponse.json({
      maintenance,
      topUp,
      send,
      stats: getScheduleStats(),
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
