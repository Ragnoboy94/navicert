import { applyEnrichResult, enrichQueueBatch } from "./bulk-load";
import { readOutreachQueue, writeOutreachQueue } from "./queue";
import type { OutreachQueue } from "./types";

export type EnrichRunnerStatus = {
  running: boolean;
  stopping: boolean;
  paused: boolean;
  pending: number;
  processedTotal: number;
  emailsFoundTotal: number;
  sessionInitialPending: number | null;
  lastBatchAt: string | null;
  lastError: string | null;
};

let abortRequested = false;
let loopPromise: Promise<void> | null = null;

const session = {
  running: false,
  lastBatchAt: null as string | null,
  lastError: null as string | null,
};

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

export function isEnrichStopRequested(): boolean {
  if (abortRequested) return true;
  return Boolean(readOutreachQueue()?.enrichPaused);
}

export function getEnrichRunnerStatus(): EnrichRunnerStatus {
  const queue = readOutreachQueue();
  const stats = queueStats(queue);
  return {
    running: session.running,
    stopping: abortRequested && session.running,
    paused: Boolean(queue?.enrichPaused),
    pending: queue?.enrichQueue.length ?? 0,
    processedTotal: stats.processedTotal,
    emailsFoundTotal: stats.emailsFoundTotal,
    sessionInitialPending: stats.sessionInitialPending,
    lastBatchAt: session.lastBatchAt,
    lastError: session.lastError,
  };
}

export function pauseBackgroundEnrich(): void {
  abortRequested = true;
  const queue = readOutreachQueue();
  if (queue) {
    writeOutreachQueue({ ...queue, enrichPaused: true });
  }
}

function clearEnrichPaused(): void {
  const queue = readOutreachQueue();
  if (queue?.enrichPaused) {
    writeOutreachQueue({ ...queue, enrichPaused: false });
  }
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
  options: { resetCounters?: boolean; force?: boolean } = {}
): {
  started: boolean;
  alreadyRunning: boolean;
  paused: boolean;
} {
  const queue = readOutreachQueue();
  if (queue?.enrichPaused && !options.force) {
    return { started: false, alreadyRunning: false, paused: true };
  }

  if (session.running) {
    return { started: false, alreadyRunning: true, paused: false };
  }

  abortRequested = false;
  clearEnrichPaused();

  if (options.resetCounters && queue) {
    writeOutreachQueue(resetEnrichStats(queue));
  } else if (queue) {
    writeOutreachQueue(ensureEnrichSession(queue));
  }

  session.lastBatchAt = null;
  session.lastError = null;

  loopPromise = runLoop();
  return { started: true, alreadyRunning: false, paused: false };
}

async function runLoop(): Promise<void> {
  session.running = true;
  session.lastError = null;

  try {
    while (!isEnrichStopRequested()) {
      const queue = readOutreachQueue();
      if (!queue?.enrichQueue.length) break;

      const result = await enrichQueueBatch(queue, undefined, {
        shouldAbort: isEnrichStopRequested,
      });

      const paused = isEnrichStopRequested();
      const latest = readOutreachQueue();
      const processedBase =
        latest?.enrichProcessedTotal ?? queue.enrichProcessedTotal ?? 0;
      const emailsBase =
        latest?.enrichEmailsFoundTotal ?? queue.enrichEmailsFoundTotal ?? 0;
      writeOutreachQueue({
        ...applyEnrichResult(queue, result),
        enrichPaused: paused,
        enrichProcessedTotal: processedBase + result.processed,
        enrichEmailsFoundTotal: emailsBase + result.emailsFound,
      });

      session.lastBatchAt = new Date().toISOString();

      if (paused) break;
      if (result.enrichPending === 0) break;
      if (result.processed === 0 && result.requeued === 0) break;
    }
  } catch (error) {
    session.lastError =
      error instanceof Error ? error.message : "Ошибка фонового обогащения";
  } finally {
    session.running = false;
    abortRequested = false;
    loopPromise = null;
  }
}

export function waitForBackgroundEnrich(): Promise<void> {
  return loopPromise ?? Promise.resolve();
}
