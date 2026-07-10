import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { emailFilterLabel } from "@/lib/outreach/email-filter";
import {
  describeFsaCursor,
  splitRangeIntoSlices,
} from "@/lib/outreach/fsa-pagination";
import {
  buildSentLookup,
  getOutreachTestEmail,
  getRecipientCooldownUntil,
  getSendBlockReason,
  isOutreachTestMode,
  isRecipientInCooldown,
  readSentRecords,
} from "@/lib/outreach/mailer";
import { getExpiringMonthRange, readOutreachQueue } from "@/lib/outreach/queue";
import { getEnrichRunnerStatus } from "@/lib/outreach/enrich-runner";
import { getScheduleStats } from "@/lib/outreach/schedule";
import {
  pickSendableCandidates,
  sendBlockLabel,
  summarizeSendBlocks,
} from "@/lib/outreach/send-selection";
import {
  getCategoryLabel,
  isUnsubscribed,
  listUnsubscribesByCategory,
} from "@/lib/outreach/unsubscribe";
import type { OutreachCategory, OutreachQueueItem } from "@/lib/outreach/types";

const CATEGORY: OutreachCategory = "expiring";

function decorateItem(
  item: OutreachQueueItem,
  sentLookup: ReturnType<typeof buildSentLookup>
) {
  const email = item.applicant?.email?.trim().toLowerCase() ?? "";
  const blockReason = getSendBlockReason(item);
  const excludedFromAuto = Boolean(item.excludeFromAutoSend);
  const manualSendable = blockReason === null;
  return {
    ...item,
    alreadySent: sentLookup.byDeclarationId.has(item.id),
    recipientAlreadySent: email ? isRecipientInCooldown(email) : false,
    recipientCooldownUntil: email ? getRecipientCooldownUntil(email) : null,
    unsubscribed: email ? isUnsubscribed(email, CATEGORY) : false,
    excludeFromAutoSend: excludedFromAuto,
    sendable: manualSendable,
    autoSendable: manualSendable && !excludedFromAuto,
    blockReason,
    blockLabel: sendBlockLabel(blockReason),
    rejectLabel: item.emailRejectReason
      ? emailFilterLabel(item.emailRejectReason)
      : undefined,
  };
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queue = readOutreachQueue();
  const sent = readSentRecords();
  const sentLookup = buildSentLookup(sent);
  const range = queue?.range ?? getExpiringMonthRange();
  const scheduleStats = getScheduleStats();

  const items = (queue?.items ?? []).map((item) =>
    decorateItem(item, sentLookup)
  );
  const rejected = (queue?.rejected ?? []).map((item) =>
    decorateItem(item, sentLookup)
  );
  const sendSummary = summarizeSendBlocks(queue?.items ?? []);

  return NextResponse.json({
    category: "expiring",
    categoryLabel: "Заканчивающиеся",
    range,
    scannedAt: queue?.scannedAt ?? null,
    nextApiPage: queue?.nextApiPage ?? 0,
    apiCursor: queue?.apiCursor ?? null,
    cursorLabel: queue?.apiCursor
      ? describeFsaCursor(
          queue.apiCursor,
          splitRangeIntoSlices(queue.range ?? range)
        )
      : null,
    pageSize: queue?.pageSize ?? 100,
    hasMore: queue?.hasMore ?? false,
    enrichPending: queue?.enrichQueue?.length ?? 0,
    enrichStatus: getEnrichRunnerStatus(),
    testMode: isOutreachTestMode(),
    testEmail: isOutreachTestMode() ? getOutreachTestEmail() : null,
    items,
    rejected,
    sendableCount: pickSendableCandidates(queue?.items ?? [], {
      forAutoSend: true,
    }).length,
    sendSummary,
    unsubscribed: listUnsubscribesByCategory(CATEGORY).map((item) => ({
      ...item,
      categoryLabel: getCategoryLabel(item.category),
    })),
    sentCount: sent.length,
    sent: sent.slice().reverse(),
    recentSent: sent.slice(-15).reverse(),
    schedule: scheduleStats.schedule,
    scheduleStats: {
      sentToday: scheduleStats.sentToday,
      remainingToday: scheduleStats.remainingToday,
      perRunLimit: scheduleStats.perRunLimit,
      runsToday: scheduleStats.runsToday,
      workHoursLabel: scheduleStats.workHoursLabel,
      nextRunLabel: scheduleStats.nextRunLabel,
    },
  });
}
