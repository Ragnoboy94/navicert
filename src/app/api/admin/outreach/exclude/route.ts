import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { setExcludeFromAutoSend } from "@/lib/outreach/queue";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const id = Number(body.id);
    const exclude = Boolean(body.exclude);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Некорректный ID" }, { status: 400 });
    }

    const queue = setExcludeFromAutoSend(id, exclude);
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
