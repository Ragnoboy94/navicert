import {
  applyEnrichResult,
  bulkLoadList,
  enrichQueueBatch,
  getEnrichBatchSize,
  listResultToQueue,
} from "./bulk-load";
import { formatFsaConnectionError } from "./fsa-connection";
import { getEnrichRunnerStatus, startBackgroundEnrich } from "./enrich-runner";
import { pickSendableCandidates } from "./send-selection";
import { readOutreachQueue, writeOutreachQueue } from "./queue";
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

async function loadFromFsa(
  category: OutreachCategory,
  mode: "reset" | "append",
  maxItems = mode === "append" ? APPEND_LOAD_MAX : INITIAL_LOAD_MAX
) {
  const existing = mode === "append" ? readOutreachQueue(category) : null;
  const result = await bulkLoadList({
    mode,
    maxItems,
    pageSize: 100,
    existingQueue: existing,
    range: mode === "append" ? existing?.range : undefined,
    category,
  });
  writeOutreachQueue(
    listResultToQueue(result, {
      mode,
      existing: existing ?? undefined,
      category,
    })
  );
  return result;
}

export async function processEnrichBacklog(
  maxMs: number,
  category: OutreachCategory = "expiring"
): Promise<CronEnrichResult> {
  const empty: CronEnrichResult = {
    ran: false,
    processed: 0,
    emailsFound: 0,
    enrichPending: readOutreachQueue(category)?.enrichQueue.length ?? 0,
  };

  const deadline = Date.now() + maxMs;
  let processed = 0;
  let emailsFound = 0;

  while (Date.now() < deadline) {
    const queue = readOutreachQueue(category);
    if (!queue?.enrichQueue.length) break;

    const batch = await enrichQueueBatch(queue, getEnrichBatchSize());
    writeOutreachQueue({
      ...applyEnrichResult(queue, batch),
      enrichProcessedTotal: (queue.enrichProcessedTotal ?? 0) + batch.processed,
      enrichEmailsFoundTotal:
        (queue.enrichEmailsFoundTotal ?? 0) + batch.emailsFound,
    });
    processed += batch.processed;
    emailsFound += batch.emailsFound;

    if (batch.enrichPending === 0) break;
    if (batch.processed === 0 && batch.requeued === 0) break;
  }

  if (processed === 0) return empty;

  return {
    ran: true,
    processed,
    emailsFound,
    enrichPending: readOutreachQueue(category)?.enrichQueue.length ?? 0,
  };
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
    const result = await loadFromFsa(category, mode, APPEND_LOAD_MAX);
    if (
      result.enrichQueue.length > 0 &&
      !readOutreachQueue(category)?.enrichPaused
    ) {
      startBackgroundEnrich({
        resetCounters: mode === "reset",
        category,
      });
    }
    writeOutreachSchedule({
      category,
      lastHourlyFsaAppendAt: now.toISOString(),
    });
    return {
      ran: true,
      mode,
      loadedFromApi: result.loadedFromApi,
      addedNew: result.addedNew,
      enrichPending: result.enrichQueue.length,
      eligible: result.items.length,
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

  const result = await loadFromFsa(category, mode);
  if (
    result.enrichQueue.length > 0 &&
    !readOutreachQueue(category)?.enrichPaused
  ) {
    startBackgroundEnrich({
      resetCounters: mode === "reset",
      category,
    });
  }
  return {
    ran: true,
    mode,
    loadedFromApi: result.loadedFromApi,
    addedNew: result.addedNew,
    enrichPending: result.enrichQueue.length,
    eligible: result.items.length,
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
  const loadResult = await loadFromFsa(category, mode);

  const enrich = await processEnrichBacklog(120_000, category);
  queue = readOutreachQueue(category);
  ready = countSendable(queue, category);

  return {
    ran: true,
    mode,
    loadedFromApi: loadResult.loadedFromApi,
    addedNew: loadResult.addedNew,
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
    startBackgroundEnrich({ category });
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
