import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { emailFilterLabel, isDisplayRejectedItem } from "@/lib/outreach/email-filter";
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
import { getNewRegistrationsRange } from "@/lib/outreach/checko-range";
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
import { parseOutreachCategory } from "@/lib/outreach/category";
import {
  getCheckoBlockReason,
  getCheckoBlockRemainingMs,
  isCheckoBlocked,
} from "@/lib/outreach/checko-guard";

/** Большой JSON очереди на проде — не рвать proxy/server на 60s. */
export const maxDuration = 300;

/** Сколько карточек отдавать в полном ответе по умолчанию (0 = все). */
const DEFAULT_LIST_LIMIT = 300;
const DEFAULT_SENT_LIMIT = 200;

function parseLimit(raw: string | null, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
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

function takeHead<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  if (limit <= 0 || rows.length <= limit) {
    return { rows, truncated: false };
  }
  return { rows: rows.slice(0, limit), truncated: true };
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const category = parseOutreachCategory(url.searchParams.get("category"));
  const lite =
    url.searchParams.get("lite") === "1" ||
    url.searchParams.get("view") === "status";
  const listLimit = parseLimit(
    url.searchParams.get("limit"),
    DEFAULT_LIST_LIMIT
  );
  const sentLimit = parseLimit(
    url.searchParams.get("sentLimit"),
    DEFAULT_SENT_LIMIT
  );

  const queue = readOutreachQueue(category);
  const sent = readSentRecordsByCategory(category);
  const range =
    queue?.range ??
    (category === "new_registrations"
      ? getNewRegistrationsRange()
      : getExpiringMonthRange());
  const scheduleStats = getScheduleStats(category);
  const fsaQueue = getFsaQueueStatus(category);
  const itemsRaw = queue?.items ?? [];
  const rejectedRaw = (queue?.rejected ?? []).filter(isDisplayRejectedItem);

  const base = {
    category,
    categoryLabel:
      category === "expiring_certificates"
        ? "Заканчивающиеся сертификаты"
        : category === "new_registrations"
          ? "Новые организации"
          : "Заканчивающиеся декларации",
    range,
    scannedAt: queue?.scannedAt ?? null,
    nextApiPage: queue?.nextApiPage ?? 0,
    apiCursor: queue?.apiCursor ?? null,
    cursorLabel:
      queue?.apiCursor && category !== "new_registrations"
        ? describeFsaCursor(
            queue.apiCursor,
            splitRangeIntoSlices(queue.range ?? range)
          )
        : queue?.apiCursor && category === "new_registrations"
          ? `checko стр. ${Math.max(queue.apiCursor.page, 1)}${
              queue.hasMore ? "+" : ""
            }`
          : null,
    pageSize: queue?.pageSize ?? 100,
    hasMore: queue?.hasMore ?? false,
    enrichPending: queue?.enrichQueue?.length ?? 0,
    enrichStatus: getEnrichRunnerStatus(category),
    checkoBlock:
      category === "new_registrations" && isCheckoBlocked()
        ? {
            active: true,
            remainingMs: getCheckoBlockRemainingMs(),
            reason: getCheckoBlockReason(),
          }
        : { active: false, remainingMs: 0, reason: null },
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
  const itemsSlice = takeHead(itemsRaw, listLimit);
  const rejectedSlice = takeHead(rejectedRaw, listLimit);
  const sentRows =
    sentLimit <= 0 || sent.length <= sentLimit
      ? sent
      : sent.slice(-sentLimit);
  const sentTruncated = sentRows.length < sent.length;

  const items = itemsSlice.rows.map((item) =>
    decorateItem(item, sentLookup, category, sent)
  );
  const rejected = rejectedSlice.rows.map((item) =>
    decorateItem(item, sentLookup, category, sent)
  );
  const sendSummary = summarizeSendBlocks(itemsRaw, { category });

  return NextResponse.json({
    ...base,
    items,
    rejected,
    itemsTruncated: itemsSlice.truncated,
    rejectedTruncated: rejectedSlice.truncated,
    listLimit,
    sendSummary,
    unsubscribed: listUnsubscribesByCategory(category).map((item) => ({
      ...item,
      categoryLabel: getCategoryLabel(item.category),
    })),
    sent: sentRows.slice().reverse(),
    sentTruncated,
    recentSent: sent.slice(-15).reverse(),
  });
}
