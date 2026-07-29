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
import { getFsaQueueStatus } from "@/lib/outreach/fsa-orchestrator";
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
  const lite =
    url.searchParams.get("lite") === "1" ||
    url.searchParams.get("view") === "status";

  const queue = readOutreachQueue(category);
  const sent = readSentRecordsByCategory(category);
  const range = queue?.range ?? getExpiringMonthRange();
  const scheduleStats = getScheduleStats(category);
  const fsaQueue = getFsaQueueStatus(category);
  const itemsRaw = queue?.items ?? [];
  const rejectedRaw = queue?.rejected ?? [];

  const base = {
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
    fsaQueue,
    testMode: isOutreachTestMode(),
    testEmail: isOutreachTestMode() ? getOutreachTestEmail() : null,
    itemsCount: itemsRaw.length,
    rejectedCount: rejectedRaw.length,
    sendableCount: pickSendableCandidates(itemsRaw, {
      forAutoSend: true,
      category,
    }).length,
    sentCount: sent.length,
    schedule: scheduleStats.schedule,
    scheduleStats: {
      sentToday: scheduleStats.sentToday,
      remainingToday: scheduleStats.remainingToday,
      perRunLimit: scheduleStats.perRunLimit,
      runsToday: scheduleStats.runsToday,
      workHoursLabel: scheduleStats.workHoursLabel,
      nextRunLabel: scheduleStats.nextRunLabel,
    },
  };

  // Лёгкий poll для UI: без items/rejected/sent (~КБ вместо МБ).
  if (lite) {
    return NextResponse.json(base);
  }

  const sentLookup = buildSentLookup(sent);
  const items = itemsRaw.map((item) =>
    decorateItem(item, sentLookup, category, sent)
  );
  const rejected = rejectedRaw.map((item) =>
    decorateItem(item, sentLookup, category, sent)
  );
  const sendSummary = summarizeSendBlocks(itemsRaw, { category });

  return NextResponse.json({
    ...base,
    items,
    rejected,
    sendSummary,
    unsubscribed: listUnsubscribesByCategory(category).map((item) => ({
      ...item,
      categoryLabel: getCategoryLabel(item.category),
    })),
    sent: sent.slice().reverse(),
    recentSent: sent.slice(-15).reverse(),
  });
}
