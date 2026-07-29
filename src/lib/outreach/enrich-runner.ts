import { applyEnrichResult, enrichQueueBatch } from "./bulk-load";
import { getFsaQueueStatus } from "./fsa-orchestrator";
import { readOutreachQueue, writeOutreachQueue } from "./queue";
import type { OutreachCategory, OutreachQueue } from "./types";

export type EnrichRunnerStatus = {
  running: boolean;
  stopping: boolean;
  paused: boolean;
  /** Задача enrich уже стоит в оркестраторе (ждёт cron) */
  queued: boolean;
  pending: number;
  processedTotal: number;
  emailsFoundTotal: number;
  sessionInitialPending: number | null;
  lastBatchAt: string | null;
  lastError: string | null;
  /** Для совместимости: эта же категория, если running */
  activeCategory: OutreachCategory | null;
};

type CategoryRuntime = {
  abortRequested: boolean;
  loopPromise: Promise<void> | null;
  running: boolean;
  lastBatchAt: string | null;
  lastError: string | null;
};

type EnrichRuntime = {
  byCategory: Record<OutreachCategory, CategoryRuntime>;
};

const globalKey = "__navicert_outreach_enrich_runtime_v2__";

function emptyCategoryRuntime(): CategoryRuntime {
  return {
    abortRequested: false,
    loopPromise: null,
    running: false,
    lastBatchAt: null,
    lastError: null,
  };
}

function runtime(): EnrichRuntime {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: EnrichRuntime;
  };
  if (!g[globalKey]) {
    g[globalKey] = {
      byCategory: {
        expiring: emptyCategoryRuntime(),
        expiring_certificates: emptyCategoryRuntime(),
      },
    };
  }
  return g[globalKey]!;
}

function catRuntime(category: OutreachCategory): CategoryRuntime {
  return runtime().byCategory[category];
}

function queueStats(queue: OutreachQueue | null) {
  const pending = queue?.enrichQueue.length ?? 0;
  const processedTotal = queue?.enrichProcessedTotal ?? 0;
  const sessionInitial =
    queue?.enrichSessionInitialPending ??
    (processedTotal > 0 || pending > 0 ? processedTotal + pending : null);
  return {
    processedTotal,
    emailsFoundTotal: queue?.enrichEmailsFoundTotal ?? 0,
    sessionInitialPending: sessionInitial,
  };
}

export function isEnrichStopRequested(category: OutreachCategory): boolean {
  const rt = catRuntime(category);
  if (rt.abortRequested) return true;
  return Boolean(readOutreachQueue(category)?.enrichPaused);
}

export function getEnrichRunnerStatus(
  category: OutreachCategory = "expiring"
): EnrichRunnerStatus {
  const rt = catRuntime(category);
  const queue = readOutreachQueue(category);
  const stats = queueStats(queue);
  const fsa = getFsaQueueStatus(category);
  const queued = fsa.enrichQueued;
  const running = rt.running || fsa.enrichRunning;
  const paused = Boolean(queue?.enrichPaused) && !queued && !running;
  return {
    running,
    stopping: rt.abortRequested && rt.running,
    paused,
    queued,
    pending: queue?.enrichQueue.length ?? 0,
    processedTotal: stats.processedTotal,
    emailsFoundTotal: stats.emailsFoundTotal,
    sessionInitialPending: stats.sessionInitialPending,
    lastBatchAt: running ? rt.lastBatchAt : null,
    lastError: rt.lastError,
    activeCategory: running ? category : null,
  };
}

export function pauseBackgroundEnrich(
  category: OutreachCategory = "expiring"
): void {
  const rt = catRuntime(category);
  rt.abortRequested = true;
  const queue = readOutreachQueue(category);
  if (queue) {
    writeOutreachQueue({ ...queue, enrichPaused: true });
  }
}

function clearEnrichPaused(category: OutreachCategory): void {
  const queue = readOutreachQueue(category);
  if (queue?.enrichPaused) {
    writeOutreachQueue({ ...queue, enrichPaused: false });
  }
}

export function resumeBackgroundEnrich(
  category: OutreachCategory = "expiring"
): void {
  const rt = catRuntime(category);
  rt.abortRequested = false;
  clearEnrichPaused(category);
}

function resetEnrichStats(queue: OutreachQueue): OutreachQueue {
  return {
    ...queue,
    enrichProcessedTotal: 0,
    enrichEmailsFoundTotal: 0,
    enrichSessionInitialPending: queue.enrichQueue.length,
  };
}

function ensureEnrichSession(queue: OutreachQueue): OutreachQueue {
  if (queue.enrichSessionInitialPending != null) return queue;
  const pending = queue.enrichQueue.length;
  if (pending === 0) return queue;
  return {
    ...queue,
    enrichSessionInitialPending: pending + (queue.enrichProcessedTotal ?? 0),
  };
}

export function startBackgroundEnrich(
  options: {
    resetCounters?: boolean;
    force?: boolean;
    category?: OutreachCategory;
  } = {}
): {
  started: boolean;
  alreadyRunning: boolean;
  paused: boolean;
} {
  const category = options.category ?? "expiring";
  const rt = catRuntime(category);
  const queue = readOutreachQueue(category);

  if (queue?.enrichPaused && !options.force) {
    return { started: false, alreadyRunning: false, paused: true };
  }

  if (rt.running) {
    return {
      started: false,
      alreadyRunning: true,
      paused: false,
    };
  }

  rt.abortRequested = false;
  clearEnrichPaused(category);

  const fresh = readOutreachQueue(category);
  if (options.resetCounters && fresh) {
    writeOutreachQueue(resetEnrichStats({ ...fresh, enrichPaused: false }));
  } else if (fresh) {
    writeOutreachQueue({
      ...ensureEnrichSession(fresh),
      enrichPaused: false,
    });
  }

  rt.lastBatchAt = null;
  rt.lastError = null;
  // Синхронно до первого await — иначе refresh сразу после клика видит running=false
  rt.running = true;
  rt.loopPromise = runLoop(category);
  return { started: true, alreadyRunning: false, paused: false };
}

async function runLoop(category: OutreachCategory): Promise<void> {
  const rt = catRuntime(category);
  rt.running = true;
  rt.lastError = null;

  try {
    while (!isEnrichStopRequested(category)) {
      const queue = readOutreachQueue(category);
      if (!queue?.enrichQueue.length) break;

      const result = await enrichQueueBatch(queue, undefined, {
        shouldAbort: () => isEnrichStopRequested(category),
      });

      const paused = isEnrichStopRequested(category);
      const latest = readOutreachQueue(category);
      const processedBase =
        latest?.enrichProcessedTotal ?? queue.enrichProcessedTotal ?? 0;
      const emailsBase =
        latest?.enrichEmailsFoundTotal ?? queue.enrichEmailsFoundTotal ?? 0;
      writeOutreachQueue({
        ...applyEnrichResult(queue, result),
        category,
        enrichPaused: paused,
        enrichProcessedTotal: processedBase + result.processed,
        enrichEmailsFoundTotal: emailsBase + result.emailsFound,
      });

      rt.lastBatchAt = new Date().toISOString();

      if (paused) break;
      if (result.enrichPending === 0) break;
      if (result.processed === 0 && result.requeued === 0) break;
    }
  } catch (error) {
    rt.lastError =
      error instanceof Error ? error.message : "Ошибка фонового обогащения";
  } finally {
    rt.running = false;
    rt.abortRequested = false;
    rt.loopPromise = null;
  }
}

export function waitForBackgroundEnrich(
  category: OutreachCategory = "expiring"
): Promise<void> {
  return catRuntime(category).loopPromise ?? Promise.resolve();
}
