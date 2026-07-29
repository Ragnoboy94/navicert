import { formatFsaConnectionError } from "./fsa-connection";
import { getEnrichRunnerStatus } from "./enrich-runner";
import { enqueueFsaJob } from "./fsa-orchestrator";
import { pickSendableCandidates } from "./send-selection";
import { readOutreachQueue } from "./queue";
import {
  getDateKey,
  getZonedParts,
  readOutreachSchedule,
  writeOutreachSchedule,
} from "./schedule";
import type { OutreachCategory, OutreachQueue } from "./types";

const TIMEZONE = "Europe/Moscow";
const MORNING_SYNC_CENTER_MINUTES = 6 * 60;
const MORNING_SYNC_WINDOW_MINUTES = 90;
const INITIAL_LOAD_MAX = 1000;
const APPEND_LOAD_MAX = 100;
export const HOURLY_FSA_APPEND_INTERVAL_MS = 60 * 60 * 1000;

export type CronSyncResult = {
  ran: boolean;
  mode?: "reset" | "append";
  loadedFromApi?: number;
  addedNew?: number;
  enrichPending?: number;
  eligible?: number;
  reason?: string;
};

export type CronEnrichResult = {
  ran: boolean;
  processed: number;
  emailsFound: number;
  enrichPending: number;
};

export type CronMaintenanceResult = {
  morningSync: CronSyncResult;
  hourlyAppend: CronSyncResult;
  enrich: CronEnrichResult;
  queueReady: number;
};

export function isHourlyFsaAppendDue(
  lastAt: string | null,
  now = Date.now()
): boolean {
  if (!lastAt) return true;
  const ts = Date.parse(lastAt);
  if (!Number.isFinite(ts)) return true;
  return now - ts >= HOURLY_FSA_APPEND_INTERVAL_MS;
}

function isMorningSyncWindow(now = new Date()): boolean {
  const { minutes } = getZonedParts(now, TIMEZONE);
  const delta = Math.abs(minutes - MORNING_SYNC_CENTER_MINUTES);
  return delta <= MORNING_SYNC_WINDOW_MINUTES / 2;
}

function queueNeedsInitialLoad(queue: OutreachQueue | null): boolean {
  return !queue?.scannedAt;
}

function countSendable(
  queue: OutreachQueue | null,
  category: OutreachCategory
): number {
  if (!queue) return 0;
  return pickSendableCandidates(queue.items, {
    forAutoSend: true,
    category,
  }).length;
}

function queueScanViaOrchestrator(
  category: OutreachCategory,
  mode: "reset" | "append",
  maxItems = mode === "append" ? APPEND_LOAD_MAX : INITIAL_LOAD_MAX
) {
  return enqueueFsaJob({
    type: "scan",
    category,
    priority: "high",
    source: "cron_maintenance",
    payload: {
      mode,
      maxItems,
      pageSize: 100,
    },
  });
}

export async function processEnrichBacklog(
  maxMs: number,
  category: OutreachCategory = "expiring"
): Promise<CronEnrichResult> {
  enqueueFsaJob({
    type: "enrich",
    category,
    priority: "low",
    source: "cron_enrich_backlog",
    payload: { maxBatches: Math.max(Math.floor(maxMs / 20_000), 1) },
  });
  const empty: CronEnrichResult = {
    ran: false,
    processed: 0,
    emailsFound: 0,
    enrichPending: readOutreachQueue(category)?.enrichQueue.length ?? 0,
  };
  return empty;
}

/** Каждый час: +100 документов поверх очереди (append), без сброса данных. */
export async function runHourlyFsaAppend(
  now = new Date(),
  category: OutreachCategory = "expiring"
): Promise<CronSyncResult> {
  const schedule = readOutreachSchedule(category);
  if (!isHourlyFsaAppendDue(schedule.lastHourlyFsaAppendAt, now.getTime())) {
    return { ran: false, reason: "interval_not_elapsed" };
  }

  const queue = readOutreachQueue(category);
  const mode: "reset" | "append" = queueNeedsInitialLoad(queue)
    ? "reset"
    : "append";

  try {
    const queued = queueScanViaOrchestrator(category, mode, APPEND_LOAD_MAX);
    writeOutreachSchedule({
      category,
      lastHourlyFsaAppendAt: now.toISOString(),
    });
    return {
      ran: true,
      mode,
      reason: queued.duplicate ? "already_queued" : "queued",
    };
  } catch (error) {
    return {
      ran: false,
      reason: formatFsaConnectionError(error),
    };
  }
}

export async function runMorningFsaSync(
  category: OutreachCategory = "expiring"
): Promise<CronSyncResult> {
  const queue = readOutreachQueue(category);
  // Утром только догрузка; полный reset — кнопка в админке.
  const mode: "reset" | "append" = queueNeedsInitialLoad(queue)
    ? "reset"
    : "append";

  const queued = queueScanViaOrchestrator(category, mode);
  return {
    ran: true,
    mode,
    reason: queued.duplicate ? "already_queued" : "queued",
  };
}

export type CronTopUpResult = CronSyncResult & {
  enrich: CronEnrichResult;
  queueReady: number;
};

/** Дозагрузка из ФСА, когда для автоотправки не хватает кандидатов */
export async function topUpQueueForSend(
  minReady: number,
  category: OutreachCategory = "expiring"
): Promise<CronTopUpResult> {
  let queue = readOutreachQueue(category);
  let ready = countSendable(queue, category);

  if (ready >= minReady) {
    return {
      ran: false,
      reason: "enough_candidates",
      enrich: {
        ran: false,
        processed: 0,
        emailsFound: 0,
        enrichPending: queue?.enrichQueue.length ?? 0,
      },
      queueReady: ready,
    };
  }

  const mode: "reset" | "append" = queueNeedsInitialLoad(queue)
    ? "reset"
    : "append";
  const queued = queueScanViaOrchestrator(category, mode, APPEND_LOAD_MAX);
  const enrich = await processEnrichBacklog(120_000, category);
  queue = readOutreachQueue(category);
  ready = countSendable(queue, category);

  return {
    ran: !queued.duplicate,
    mode,
    reason: queued.duplicate ? "already_queued" : "queued",
    enrichPending: queue?.enrichQueue.length ?? 0,
    eligible: queue?.items.length ?? 0,
    enrich,
    queueReady: ready,
  };
}

export async function ensureQueueForScheduledSend(
  perRunLimit: number,
  category: OutreachCategory = "expiring"
): Promise<CronTopUpResult | null> {
  const ready = countSendable(readOutreachQueue(category), category);
  if (ready >= perRunLimit) return null;
  return topUpQueueForSend(perRunLimit, category);
}

export async function runCronMaintenance(
  options: { maxMs?: number; category?: OutreachCategory } = {}
): Promise<CronMaintenanceResult> {
  const category = options.category ?? "expiring";
  const maxMs = options.maxMs ?? 240_000;
  const startedAt = Date.now();
  const now = new Date();
  const dateKey = getDateKey(now, TIMEZONE);
  const schedule = readOutreachSchedule(category);

  let morningSync: CronSyncResult = { ran: false, reason: "outside_window" };

  if (isMorningSyncWindow(now) && schedule.lastFsaSyncDate !== dateKey) {
    morningSync = await runMorningFsaSync(category);
    writeOutreachSchedule({
      category,
      lastFsaSyncDate: dateKey,
      lastFsaSyncAt: new Date().toISOString(),
    });
  }

  const hourlyAppend = await runHourlyFsaAppend(now, category);

  const elapsed = Date.now() - startedAt;
  const enrichBudget = Math.max(maxMs - elapsed, 0);
  const queue = readOutreachQueue(category);
  const enrichStatus = getEnrichRunnerStatus(category);
  if (
    enrichBudget > 30_000 &&
    (queue?.enrichQueue.length ?? 0) > 0 &&
    !queue?.enrichPaused &&
    !enrichStatus.running
  ) {
    enqueueFsaJob({
      type: "enrich",
      category,
      priority: "low",
      source: "cron_maintenance_enrich",
      payload: { maxBatches: Math.max(Math.floor(enrichBudget / 20_000), 1) },
    });
  }
  const enrich =
    enrichStatus.running || (queue?.enrichQueue.length ?? 0) > 0
      ? {
          ran: true,
          processed: getEnrichRunnerStatus(category).processedTotal,
          emailsFound: getEnrichRunnerStatus(category).emailsFoundTotal,
          enrichPending: getEnrichRunnerStatus(category).pending,
        }
      : {
          ran: false,
          processed: 0,
          emailsFound: 0,
          enrichPending: 0,
        };

  return {
    morningSync,
    hourlyAppend,
    enrich,
    queueReady: countSendable(readOutreachQueue(category), category),
  };
}
