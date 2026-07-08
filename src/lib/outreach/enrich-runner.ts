import { applyEnrichResult, enrichQueueBatch } from "./bulk-load";
import { readOutreachQueue, writeOutreachQueue } from "./queue";

export type EnrichRunnerStatus = {
  running: boolean;
  stopping: boolean;
  paused: boolean;
  pending: number;
  processedTotal: number;
  emailsFoundTotal: number;
  lastBatchAt: string | null;
  lastError: string | null;
};

let abortRequested = false;
let loopPromise: Promise<void> | null = null;

const session = {
  running: false,
  processedTotal: 0,
  emailsFoundTotal: 0,
  lastBatchAt: null as string | null,
  lastError: null as string | null,
};

export function isEnrichStopRequested(): boolean {
  if (abortRequested) return true;
  return Boolean(readOutreachQueue()?.enrichPaused);
}

export function getEnrichRunnerStatus(): EnrichRunnerStatus {
  const queue = readOutreachQueue();
  return {
    running: session.running,
    stopping: abortRequested && session.running,
    paused: Boolean(queue?.enrichPaused),
    pending: queue?.enrichQueue.length ?? 0,
    processedTotal: session.processedTotal,
    emailsFoundTotal: session.emailsFoundTotal,
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

  if (options.resetCounters) {
    session.processedTotal = 0;
    session.emailsFoundTotal = 0;
    session.lastBatchAt = null;
    session.lastError = null;
  }

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
      writeOutreachQueue({
        ...applyEnrichResult(queue, result),
        enrichPaused: paused,
      });

      session.processedTotal += result.processed;
      session.emailsFoundTotal += result.emailsFound;
      session.lastBatchAt = new Date().toISOString();

      if (paused) break;
      if (result.enrichPending === 0) break;
      if (result.processed === 0) break;
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
