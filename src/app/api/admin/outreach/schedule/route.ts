import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import {
  getScheduleStats,
  runScheduledOutreach,
  writeOutreachSchedule,
} from "@/lib/outreach/schedule";

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
  return NextResponse.json(getScheduleStats(category));
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    const category = parseCategory(url.searchParams.get("category"));

    if (body.action === "run") {
      const result = await runScheduledOutreach({ force: true, category });
      return NextResponse.json({
        ...result,
        stats: getScheduleStats(category),
      });
    }

    const schedule = writeOutreachSchedule({
      enabled: body.enabled,
      emailsPerDay: body.emailsPerDay,
      category,
    });

    return NextResponse.json({
      ok: true,
      ...getScheduleStats(category),
      schedule,
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
