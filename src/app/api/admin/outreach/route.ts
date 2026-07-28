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
  readSentRecordsByCategory,
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

function parseCategory(raw: string | null): OutreachCategory {
  return raw === "expiring_certificates" ? "expiring_certificates" : "expiring";
}

function decorateItem(
  item: OutreachQueueItem,
  sentLookup: ReturnType<typeof buildSentLookup>,
  category: OutreachCategory,
  sent: ReturnType<typeof readSentRecordsByCategory>
) {
  const email = item.applicant?.email?.trim().toLowerCase() ?? "";
  const blockReason = getSendBlockReason(item, { category });
  const excludedFromAuto = Boolean(item.excludeFromAutoSend);
  const manualSendable = blockReason === null;
  return {
    ...item,
    alreadySent: sentLookup.byDeclarationId.has(item.id),
    recipientAlreadySent: email ? isRecipientInCooldown(email, sent) : false,
    recipientCooldownUntil: email
      ? getRecipientCooldownUntil(email, sent)
      : null,
    unsubscribed: email ? isUnsubscribed(email, category) : false,
    excludeFromAutoSend: excludedFromAuto,
    sendable: manualSendable,
    autoSendable: manualSendable && !excludedFromAuto,
    blockReason,
    blockLabel: sendBlockLabel(blockReason, category),
    rejectLabel: item.emailRejectReason
      ? emailFilterLabel(item.emailRejectReason)
      : undefined,
  };
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = parseCategory(url.searchParams.get("category"));

  const queue = readOutreachQueue(category);
  const sent = readSentRecordsByCategory(category);
  const sentLookup = buildSentLookup(sent);
  const range = queue?.range ?? getExpiringMonthRange();
  const scheduleStats = getScheduleStats(category);

  const items = (queue?.items ?? []).map((item) =>
    decorateItem(item, sentLookup, category, sent)
  );
  const rejected = (queue?.rejected ?? []).map((item) =>
    decorateItem(item, sentLookup, category, sent)
  );
  const sendSummary = summarizeSendBlocks(queue?.items ?? [], { category });

  return NextResponse.json({
    category,
    categoryLabel:
      category === "expiring_certificates"
        ? "Заканчивающиеся сертификаты"
        : "Заканчивающиеся декларации",
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
    enrichStatus: getEnrichRunnerStatus(category),
    testMode: isOutreachTestMode(),
    testEmail: isOutreachTestMode() ? getOutreachTestEmail() : null,
    items,
    rejected,
    sendableCount: pickSendableCandidates(queue?.items ?? [], {
      forAutoSend: true,
      category,
    }).length,
    sendSummary,
    unsubscribed: listUnsubscribesByCategory(category).map((item) => ({
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
