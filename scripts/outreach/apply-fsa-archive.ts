#!/usr/bin/env tsx
/**
 * Применяет data/fsa-archive.json к рабочей очереди:
 * в outreach-queue.json попадают только записи текущего окна (или --from/--to).
 *
 *   npx tsx scripts/outreach/apply-fsa-archive.ts
 *   npx tsx scripts/outreach/apply-fsa-archive.ts --from 15.08.2026 --to 30.08.2026
 */
import { config } from "dotenv";
import path from "path";
import {
  buildQueueFromArchive,
  readFsaArchive,
} from "../../src/lib/outreach/archive";
import {
  getExpiringMonthRange,
  readOutreachQueue,
  writeOutreachQueue,
} from "../../src/lib/outreach/queue";

config({ path: path.join(process.cwd(), ".env.local") });

function parseArgs(argv: string[]): { from?: string; to?: string } {
  let from: string | undefined;
  let to: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from" && argv[i + 1]) from = argv[++i];
    if (argv[i] === "--to" && argv[i + 1]) to = argv[++i];
  }
  return { from, to };
}

function main() {
  const archive = readFsaArchive();
  if (!archive) {
    console.error("Нет data/fsa-archive.json — сначала dump-fsa-range.ts");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const range =
    args.from && args.to
      ? { from: args.from, to: args.to }
      : getExpiringMonthRange();

  const existing = readOutreachQueue();
  const queue = buildQueueFromArchive(archive, range, { existing });
  writeOutreachQueue(queue);

  console.log(`Архив: ${archive.declarations.length} деклараций (${archive.range.from} — ${archive.range.to})`);
  console.log(`Окно показа: ${range.from} — ${range.to}`);
  console.log(`В очереди: ${queue.items.length} eligible, ${queue.rejected.length} rejected, ${queue.enrichQueue.length} без email`);
}

main();
