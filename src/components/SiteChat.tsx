import { unstable_noStore as noStore } from "next/cache";
import { Chaport } from "@/components/Chaport";
import { ChatWidget } from "@/components/ChatWidget";
import { getChatSettings } from "@/lib/chat/settings";

/** Chaport или свой чат — по переключателю в настройках (без кэша). */
export function SiteChat() {
  noStore();
  const settings = getChatSettings();
  if (!settings.customChatEnabled) return <Chaport />;
  return (
    <ChatWidget
      initialLauncherColor={settings.launcherColor}
      initialGreetingDelaySec={settings.greetingDelaySec}
      initialOfflineAfterVisitorSec={settings.offlineAfterVisitorSec}
      initialWaitingReplyText={settings.waitingReplyText}
    />
  );
}
