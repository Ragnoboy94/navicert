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
import type { OutreachQueue } from "./types";

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

function countSendable(queue: OutreachQueue | null): number {
  if (!queue) return 0;
  return pickSendableCandidates(queue.items, { forAutoSend: true }).length;
}

async function loadFromFsa(
  mode: "reset" | "append",
  maxItems = mode === "append" ? APPEND_LOAD_MAX : INITIAL_LOAD_MAX
) {
  const existing = mode === "append" ? readOutreachQueue() : null;
  const result = await bulkLoadList({
    mode,
    maxItems,
    pageSize: 100,
    existingQueue: existing,
    range: mode === "append" ? existing?.range : undefined,
  });
  writeOutreachQueue(
    listResultToQueue(result, { mode, existing: existing ?? undefined })
  );
  return result;
}

export async function processEnrichBacklog(
  maxMs: number
): Promise<CronEnrichResult> {
  const empty: CronEnrichResult = {
    ran: false,
    processed: 0,
    emailsFound: 0,
    enrichPending: readOutreachQueue()?.enrichQueue.length ?? 0,
  };

  const deadline = Date.now() + maxMs;
  let processed = 0;
  let emailsFound = 0;

  while (Date.now() < deadline) {
    const queue = readOutreachQueue();
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
    enrichPending: readOutreachQueue()?.enrichQueue.length ?? 0,
  };
}

/** Каждый час: +100 деклараций поверх очереди (append), без сброса данных. */
export async function runHourlyFsaAppend(
  now = new Date()
): Promise<CronSyncResult> {
  const schedule = readOutreachSchedule();
  if (!isHourlyFsaAppendDue(schedule.lastHourlyFsaAppendAt, now.getTime())) {
    return { ran: false, reason: "interval_not_elapsed" };
  }

  const queue = readOutreachQueue();
  const mode: "reset" | "append" = queueNeedsInitialLoad(queue)
    ? "reset"
    : "append";

  try {
    const result = await loadFromFsa(mode, APPEND_LOAD_MAX);
    if (result.enrichQueue.length > 0 && !readOutreachQueue()?.enrichPaused) {
      startBackgroundEnrich({ resetCounters: mode === "reset" });
    }
    writeOutreachSchedule({
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

export async function runMorningFsaSync(): Promise<CronSyncResult> {
  const queue = readOutreachQueue();
  // Утром только догрузка; полный reset — кнопка в админке.
  const mode: "reset" | "append" = queueNeedsInitialLoad(queue)
    ? "reset"
    : "append";

  const result = await loadFromFsa(mode);
  if (result.enrichQueue.length > 0 && !readOutreachQueue()?.enrichPaused) {
    startBackgroundEnrich({ resetCounters: mode === "reset" });
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
  minReady: number
): Promise<CronTopUpResult> {
  let queue = readOutreachQueue();
  let ready = countSendable(queue);

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
  const loadResult = await loadFromFsa(mode);

  const enrich = await processEnrichBacklog(120_000);
  queue = readOutreachQueue();
  ready = countSendable(queue);

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
  perRunLimit: number
): Promise<CronTopUpResult | null> {
  const ready = countSendable(readOutreachQueue());
  if (ready >= perRunLimit) return null;
  return topUpQueueForSend(perRunLimit);
}

export async function runCronMaintenance(
  options: { maxMs?: number } = {}
): Promise<CronMaintenanceResult> {
  const maxMs = options.maxMs ?? 240_000;
  const startedAt = Date.now();
  const now = new Date();
  const dateKey = getDateKey(now, TIMEZONE);
  const schedule = readOutreachSchedule();

  let morningSync: CronSyncResult = { ran: false, reason: "outside_window" };

  if (isMorningSyncWindow(now) && schedule.lastFsaSyncDate !== dateKey) {
    morningSync = await runMorningFsaSync();
    writeOutreachSchedule({
      lastFsaSyncDate: dateKey,
      lastFsaSyncAt: new Date().toISOString(),
    });
  }

  const hourlyAppend = await runHourlyFsaAppend(now);

  const elapsed = Date.now() - startedAt;
  const enrichBudget = Math.max(maxMs - elapsed, 0);
  const queue = readOutreachQueue();
  if (
    enrichBudget > 30_000 &&
    (queue?.enrichQueue.length ?? 0) > 0 &&
    !queue?.enrichPaused &&
    !getEnrichRunnerStatus().running
  ) {
    startBackgroundEnrich();
  }
  const enrich =
    getEnrichRunnerStatus().running || (queue?.enrichQueue.length ?? 0) > 0
      ? {
          ran: true,
          processed: getEnrichRunnerStatus().processedTotal,
          emailsFound: getEnrichRunnerStatus().emailsFoundTotal,
          enrichPending: getEnrichRunnerStatus().pending,
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
    queueReady: countSendable(readOutreachQueue()),
  };
}
