import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  getScheduleStats,
  runScheduledOutreach,
  writeOutreachSchedule,
} from "@/lib/outreach/schedule";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(getScheduleStats());
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));

    if (body.action === "run") {
      const result = await runScheduledOutreach({ force: true });
      return NextResponse.json({
        ...result,
        stats: getScheduleStats(),
      });
    }

    const schedule = writeOutreachSchedule({
      enabled: body.enabled,
      emailsPerDay: body.emailsPerDay,
    });

    return NextResponse.json({
      ok: true,
      ...getScheduleStats(schedule),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось сохранить расписание",
      },
      { status: 500 }
    );
  }
}
