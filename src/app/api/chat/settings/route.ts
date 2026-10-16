import { NextResponse } from "next/server";
import { getChatSettings } from "@/lib/chat/settings";

/** Публичные настройки виджета (приветствие, офлайн). */
export async function GET() {
  const settings = getChatSettings();
  return NextResponse.json({
    ok: true,
    settings: {
      greetingDelaySec: settings.greetingDelaySec,
      offlineAfterVisitorSec: settings.offlineAfterVisitorSec,
      waitingReplyText: settings.waitingReplyText,
      launcherColor: settings.launcherColor,
    },
  });
}
