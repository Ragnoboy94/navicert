import { classifyEmail } from "./email-filter";
import {
  detectDomainTypo,
  isMxValidationEnabled,
  suggestEmailFix,
  validateEmailDeliverability,
  validateEmailSyntax,
} from "./email-validator";
import { readOutreachQueue, writeOutreachQueue } from "./queue";
import type { OutreachQueue, OutreachQueueItem } from "./types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  );
  return results;
}

export type QueueEmailValidationResult = {
  checked: number;
  movedToRejected: number;
  stillEligible: number;
  byReason: Record<string, number>;
};

/**
 * MX-проверка eligible-очереди: невалидные → rejected.
 * Синтаксис/опечатки уже отсеивает classifyEmail.
 */
export async function validateQueueEmails(
  queue: OutreachQueue,
  options?: { concurrency?: number; delayMs?: number }
): Promise<{ queue: OutreachQueue; stats: QueueEmailValidationResult }> {
  const concurrency = Math.min(Math.max(options?.concurrency ?? 8, 1), 20);
  const delayMs = Math.max(options?.delayMs ?? 50, 0);

  const eligible = [...queue.items];
  const kept: OutreachQueueItem[] = [];
  const moved: OutreachQueueItem[] = [];
  const byReason: Record<string, number> = {};

  const outcomes = await mapWithConcurrency(eligible, concurrency, async (item) => {
    if (delayMs > 0) await sleep(delayMs);
    const email = item.applicant?.email;
    const classified = classifyEmail(email);
    if (classified.status !== "eligible") {
      return {
        item,
        ok: false as const,
        reason: classified.reason ?? "email_missing",
      };
    }
    if (!isMxValidationEnabled()) {
      return { item, ok: true as const };
    }
    const check = await validateEmailDeliverability(email);
    if (check.ok) return { item, ok: true as const };
    return { item, ok: false as const, reason: check.reason };
  });

  for (const outcome of outcomes) {
    if (outcome.ok) {
      kept.push(outcome.item);
      continue;
    }
    byReason[outcome.reason] = (byReason[outcome.reason] ?? 0) + 1;
    moved.push({
      ...outcome.item,
      emailStatus: "rejected",
      emailRejectReason: outcome.reason,
    });
  }

  return {
    queue: {
      ...queue,
      scannedAt: new Date().toISOString(),
      items: kept,
      rejected: [...queue.rejected, ...moved],
    },
    stats: {
      checked: eligible.length,
      movedToRejected: moved.length,
      stillEligible: kept.length,
      byReason,
    },
  };
}

/** Быстрая offline-оценка без DNS (синтаксис + опечатки). */
export function auditQueueEmailsSync(queue: OutreachQueue) {
  let invalid = 0;
  const byReason: Record<string, number> = {};
  for (const item of queue.items) {
    const email = item.applicant?.email ?? "";
    const syntax = validateEmailSyntax(email);
    const typo = detectDomainTypo(email);
    const issue = syntax ?? typo;
    if (issue) {
      invalid += 1;
      byReason[issue] = (byReason[issue] ?? 0) + 1;
    }
  }
  return { total: queue.items.length, invalid, byReason };
}

/**
 * Перед рассылкой: проверить всю eligible-очередь, плохие → rejected, сохранить.
 */
export async function prepareQueueForSending(
  queue: OutreachQueue,
  options?: { concurrency?: number; delayMs?: number; persist?: boolean }
): Promise<{ queue: OutreachQueue; stats: QueueEmailValidationResult | null }> {
  if (!queue.items.length) {
    return { queue, stats: null };
  }

  const { queue: validated, stats } = await validateQueueEmails(queue, options);

  if (options?.persist !== false && stats.movedToRejected > 0) {
    writeOutreachQueue(validated);
  }

  return { queue: validated, stats };
}

/** Прочитать очередь, провалидировать перед send, вернуть актуальную. */
export async function prepareOutreachQueueForSending(): Promise<{
  queue: OutreachQueue | null;
  stats: QueueEmailValidationResult | null;
}> {
  const queue = readOutreachQueue();
  if (!queue) return { queue: null, stats: null };
  const prepared = await prepareQueueForSending(queue);
  return prepared;
}

export { suggestEmailFix, classifyEmail };
