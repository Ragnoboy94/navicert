#!/usr/bin/env tsx
/**
 * Проверка email в outreach-queue.json до отправки (MX + синтаксис).
 *
 *   npm run outreach:validate-emails
 *   npm run outreach:validate-emails -- --dry-run
 */
import { config } from "dotenv";
import path from "path";
import { readOutreachQueue } from "../../src/lib/outreach/queue";
import {
  auditQueueEmailsSync,
  prepareQueueForSending,
} from "../../src/lib/outreach/queue-email-validation";

config({ path: path.join(process.cwd(), ".env.local") });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const queue = readOutreachQueue();
  if (!queue) {
    console.error("Нет data/outreach-queue.json");
    process.exit(1);
  }

  const offline = auditQueueEmailsSync(queue);
  console.log(`Eligible в очереди: ${offline.total}`);
  console.log(`Offline (синтаксис/опечатки): ${offline.invalid}`);
  if (Object.keys(offline.byReason).length) {
    console.log("  причины:", offline.byReason);
  }

  console.log("\nMX-проверка доменов...");
  const { queue: updated, stats } = await prepareQueueForSending(queue, {
    concurrency: 8,
    delayMs: 30,
    persist: !dryRun,
  });

  if (!stats) {
    console.log("Eligible пуст — нечего проверять");
    return;
  }

  console.log(`Проверено: ${stats.checked}`);
  console.log(`Остаётся eligible: ${stats.stillEligible}`);
  console.log(`Убрано в rejected: ${stats.movedToRejected}`);
  if (Object.keys(stats.byReason).length) {
    console.log("  причины:", stats.byReason);
  }

  if (!dryRun && stats.movedToRejected > 0) {
    console.log("\nСохранено: data/outreach-queue.json");
  } else if (dryRun) {
    console.log("\n--dry-run: файл не изменён");
  } else {
    console.log("\nИзменений нет");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
