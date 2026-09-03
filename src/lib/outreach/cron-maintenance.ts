import { formatFsaConnectionError } from "./fsa-connection";
import { getEnrichRunnerStatus } from "./enrich-runner";
import { enqueueFsaJob, getFsaQueueStatus } from "./fsa-orchestrator";
import { pickSendableCandidates } from "./send-selection";
import { readOutreachQueue } from "./queue";
import {
  getDateKey,
  getZonedParts,
  readOutreachSchedule,
} from "./schedule";
import { isFsaOutreachCategory, isNewRegistrationsCategory } from "./category";
import { isCheckoBlocked } from "./checko-guard";
import type { OutreachCategory, OutreachQueue } from "./types";

const TIMEZONE = "Europe/Moscow";
/** Окно ±45 мин вокруг центра (как было для утренней синхронизации). */
const DAILY_SCAN_WINDOW_MINUTES = 90;
const INITIAL_LOAD_MAX = 1000;
const APPEND_LOAD_MAX = 100;
const DAILY_SCAN_MAX = 500;

/** @deprecated Почасовой append отключён; оставлено для совместимости тестов. */
export const HOURLY_FSA_APPEND_INTERVAL_MS = 60 * 60 * 1000;

/** Ночные слоты сбора данных (МСК): декларации, сертификаты, checko. */
const DAILY_SCAN_CENTER_MINUTES: Record<OutreachCategory, number> = {
  expiring: 2 * 60,
  expiring_certificates: 3 * 60,
  /** Checko: 06:00 МСК (±45 мин → 05:15–06:45). */
  new_registrations: 6 * 60,
};

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

/** @deprecated Почасовой append отключён. */
export function isHourlyFsaAppendDue(
  lastAt: string | null,
  now = Date.now()
): boolean {
  if (!lastAt) return true;
  const ts = Date.parse(lastAt);
  if (!Number.isFinite(ts)) return true;
  return now - ts >= HOURLY_FSA_APPEND_INTERVAL_MS;
}

export function isDailyScanWindow(
  category: OutreachCategory,
  now = new Date()
): boolean {
  const center = DAILY_SCAN_CENTER_MINUTES[category];
  const { minutes } = getZonedParts(now, TIMEZONE);
  const delta = Math.abs(minutes - center);
  return delta <= DAILY_SCAN_WINDOW_MINUTES / 2;
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
  maxItems = mode === "append" ? APPEND_LOAD_MAX : INITIAL_LOAD_MAX,
  dailyScan = false
) {
  return enqueueFsaJob({
    type: "scan",
    category,
    priority: "high",
    source: dailyScan ? "cron_daily_scan" : "cron_maintenance",
    payload: {
      mode,
      maxItems,
      pageSize: 100,
      dailyScan,
    },
  });
}

export async function processEnrichBacklog(
  maxMs: number,
  category: OutreachCategory = "expiring"
): Promise<CronEnrichResult> {
  const queue = readOutreachQueue(category);
  const enrichPending = queue?.enrichQueue.length ?? 0;
  if (!enrichPending || queue?.enrichPaused) {
    return {
      ran: false,
      processed: 0,
      emailsFound: 0,
      enrichPending,
    };
  }

  enqueueFsaJob({
    type: "enrich",
    category,
    priority: "low",
    source: "cron_enrich_backlog",
    payload: { maxBatches: Math.max(Math.floor(maxMs / 20_000), 1) },
  });
  return {
    ran: true,
    processed: 0,
    emailsFound: 0,
    enrichPending,
  };
}

/** @deprecated Почасовой append отключён — сбор данных только ночным cron. */
export async function runHourlyFsaAppend(
  _now = new Date(),
  _category: OutreachCategory = "expiring"
): Promise<CronSyncResult> {
  return { ran: false, reason: "disabled" };
}

/** Ночной cron: один append-скан узкого дня (FSA to / checko вчера→сегодня). */
export async function runDailyScanCron(
  category: OutreachCategory = "expiring",
  now = new Date()
): Promise<CronSyncResult> {
  if (!isDailyScanWindow(category, now)) {
    return { ran: false, reason: "outside_window" };
  }

  const dateKey = getDateKey(now, TIMEZONE);
  const schedule = readOutreachSchedule(category);
  if (schedule.lastFsaSyncDate === dateKey) {
    return { ran: false, reason: "already_ran_today" };
  }

  const queue = readOutreachQueue(category);
  if (queueNeedsInitialLoad(queue)) {
    return { ran: false, reason: "needs_initial_load" };
  }

  if (getFsaQueueStatus(category).pendingScanAppend > 0) {
    return { ran: false, reason: "scan_backlog" };
  }

  try {
    const queued = queueScanViaOrchestrator(
      category,
      "append",
      DAILY_SCAN_MAX,
      true
    );
    // lastFsaSyncDate пишет runScanJob после реального результата (не при enqueue).
    return {
      ran: true,
      mode: "append",
      reason: queued.duplicate ? "already_queued" : "queued",
    };
  } catch (error) {
    return {
      ran: false,
      reason: formatFsaConnectionError(error),
    };
  }
}

/** @deprecated Используйте runDailyScanCron. */
export async function runMorningFsaSync(
  category: OutreachCategory = "expiring"
): Promise<CronSyncResult> {
  return runDailyScanCron(category);
}

export type CronTopUpResult = CronSyncResult & {
  enrich: CronEnrichResult;
  queueReady: number;
};

/** Дозагрузка перед автоотправкой: только enrich, без scan (сбор — ночной cron). */
export async function topUpQueueForSend(
  minReady: number,
  category: OutreachCategory = "expiring"
): Promise<CronTopUpResult> {
  const queue = readOutreachQueue(category);
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

  const enrich = await processEnrichBacklog(120_000, category);
  const refreshed = readOutreachQueue(category);
  ready = countSendable(refreshed, category);

  return {
    ran: enrich.ran,
    reason: enrich.ran ? "enrich_queued" : "no_enrich_backlog",
    enrichPending: refreshed?.enrichQueue.length ?? 0,
    eligible: refreshed?.items.length ?? 0,
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

  const morningSync = await runDailyScanCron(category, now);
  const hourlyAppend: CronSyncResult = { ran: false, reason: "disabled" };

  const elapsed = Date.now() - startedAt;
  const enrichBudget = Math.max(maxMs - elapsed, 0);
  const queue = readOutreachQueue(category);
  const enrichStatus = getEnrichRunnerStatus(category);
  const checkoOk =
    !isNewRegistrationsCategory(category) || !isCheckoBlocked();
  if (
    (isFsaOutreachCategory(category) || isNewRegistrationsCategory(category)) &&
    checkoOk &&
    enrichBudget > 30_000 &&
    (queue?.enrichQueue.length ?? 0) > 0 &&
    !queue?.enrichPaused &&
    !enrichStatus.running
  ) {
    const batchMs = isNewRegistrationsCategory(category) ? 60_000 : 20_000;
    enqueueFsaJob({
      type: "enrich",
      category,
      priority: "low",
      source: "cron_maintenance_enrich",
      payload: {
        maxBatches: isNewRegistrationsCategory(category)
          ? 1
          : Math.max(Math.floor(enrichBudget / batchMs), 1),
      },
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
