import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { setExcludeFromAutoSend } from "@/lib/outreach/queue";
import type { OutreachCategory } from "@/lib/outreach/types";

function parseCategory(raw: string | null | undefined): OutreachCategory {
  return raw === "expiring_certificates" ? "expiring_certificates" : "expiring";
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const url = new URL(request.url);
    const category = parseCategory(body.category ?? url.searchParams.get("category"));
    const id = Number(body.id);
    const exclude = Boolean(body.exclude);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Некорректный ID" }, { status: 400 });
    }

    const queue = setExcludeFromAutoSend(id, exclude, category);
    if (!queue) {
      return NextResponse.json(
        { error: "Декларация не найдена в очереди" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      id,
      excludeFromAutoSend: exclude,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось обновить очередь",
      },
      { status: 500 }
    );
  }
}
