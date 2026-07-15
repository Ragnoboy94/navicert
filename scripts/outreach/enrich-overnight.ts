/**
 * Ночное насыщение queue из data/fsa-archive.json (локаль, без прокси).
 *
 * По умолчанию: apply на весь диапазон архива → enrich до пустого enrichQueue.
 *
 *   npm run outreach:enrich-archive
 *   npm run outreach:enrich-archive -- --window          # только текущее soft-окно
 *   npm run outreach:enrich-archive -- --from 14.08.2026 --to 31.12.2026
 *   npm run outreach:enrich-archive -- --resume          # не трогать apply, продолжить queue
 *
 * Остановка: Ctrl+C (очередь сохранится, enrichPaused=true).
 */
import { config } from "dotenv";
import path from "path";
import {
  buildQueueFromArchive,
  readFsaArchive,
} from "../../src/lib/outreach/archive";
import {
  applyEnrichResult,
  enrichQueueBatch,
} from "../../src/lib/outreach/bulk-load";
import { closeEnrichCardsWorker } from "../../src/lib/outreach/enrich-applicants";
import {
  getExpiringMonthRange,
  readOutreachQueue,
  writeOutreachQueue,
} from "../../src/lib/outreach/queue";

config({ path: path.join(process.cwd(), ".env.local") });

process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
delete process.env.OUTREACH_FSA_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.HTTP_PROXY;

type Args = {
  resume: boolean;
  window: boolean;
  from?: string;
  to?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { resume: false, window: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--resume") args.resume = true;
    if (argv[i] === "--window") args.window = true;
    if (argv[i] === "--from" && argv[i + 1]) args.from = argv[++i];
    if (argv[i] === "--to" && argv[i + 1]) args.to = argv[++i];
  }
  return args;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

let stopRequested = false;

process.on("SIGINT", () => {
  if (stopRequested) {
    console.log("\nПринудительный выход.");
    process.exit(130);
  }
  stopRequested = true;
  console.log("\nСтоп после текущего батча (Ctrl+C ещё раз — сразу)...");
  const queue = readOutreachQueue();
  if (queue) writeOutreachQueue({ ...queue, enrichPaused: true });
});

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.resume) {
    const archive = readFsaArchive();
    if (!archive) {
      console.error("Нет data/fsa-archive.json — сначала: npm run outreach:dump-fsa");
      process.exit(1);
    }

    const range =
      args.from && args.to
        ? { from: args.from, to: args.to }
        : args.window
          ? getExpiringMonthRange()
          : archive.range;

    const existing = readOutreachQueue();
    const queue = buildQueueFromArchive(archive, range, { existing });
    writeOutreachQueue({
      ...queue,
      enrichPaused: false,
      enrichProcessedTotal: 0,
      enrichEmailsFoundTotal: 0,
      enrichSessionInitialPending: queue.enrichQueue.length,
    });

    console.log(
      `[${stamp()}] apply: архив ${archive.declarations.length} → окно ${range.from}–${range.to}`
    );
    console.log(
      `[${stamp()}] queue: eligible ${queue.items.length}, rejected ${queue.rejected.length}, enrich ${queue.enrichQueue.length}`
    );
  } else {
    const queue = readOutreachQueue();
    if (!queue?.enrichQueue.length) {
      console.error("--resume: enrichQueue пуст. Снимите --resume и сделайте apply.");
      process.exit(1);
    }
    writeOutreachQueue({
      ...queue,
      enrichPaused: false,
      enrichSessionInitialPending:
        queue.enrichSessionInitialPending ??
        queue.enrichQueue.length + (queue.enrichProcessedTotal ?? 0),
    });
    console.log(
      `[${stamp()}] resume: pending ${queue.enrichQueue.length}, already processed ${queue.enrichProcessedTotal ?? 0}`
    );
  }

  const startedAt = Date.now();
  let batches = 0;
  let consecutiveEmpty = 0;

  while (!stopRequested) {
    const queue = readOutreachQueue();
    if (!queue?.enrichQueue.length) {
      console.log(`[${stamp()}] готово: enrichQueue пуст`);
      break;
    }

    const pendingBefore = queue.enrichQueue.length;
    const sessionTotal =
      queue.enrichSessionInitialPending ??
      pendingBefore + (queue.enrichProcessedTotal ?? 0);

    try {
      const result = await enrichQueueBatch(queue, undefined, {
        shouldAbort: () => stopRequested,
      });

      const latest = readOutreachQueue();
      const processedBase =
        latest?.enrichProcessedTotal ?? queue.enrichProcessedTotal ?? 0;
      const emailsBase =
        latest?.enrichEmailsFoundTotal ?? queue.enrichEmailsFoundTotal ?? 0;

      writeOutreachQueue({
        ...applyEnrichResult(queue, result),
        enrichPaused: stopRequested,
        enrichProcessedTotal: processedBase + result.processed,
        enrichEmailsFoundTotal: emailsBase + result.emailsFound,
      });

      batches += 1;
      const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
      const done = processedBase + result.processed;
      console.log(
        `[${stamp()}] batch ${batches}: +${result.processed} done, +${result.emailsFound} email, ` +
          `cards ${result.enrichedFromCards}, pending ${result.enrichPending}, ` +
          `итог ${done}/${sessionTotal}, eligible ${result.items.length}, ${elapsedMin} мин`
      );

      if (stopRequested) break;
      if (result.enrichPending === 0) break;

      if (result.processed === 0 && result.requeued === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 3) {
          console.error(
            `[${stamp()}] стоп: 3 батча без прогресса (pending ${result.enrichPending})`
          );
          process.exitCode = 1;
          break;
        }
        await sleep(5_000);
      } else {
        consecutiveEmpty = 0;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[${stamp()}] ошибка батча: ${msg}`);
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 5 || stopRequested) {
        process.exitCode = 1;
        break;
      }
      console.log(`[${stamp()}] пауза 20с и повтор...`);
      await sleep(20_000);
    }
  }

  const final = readOutreachQueue();
  console.log(
    `\n[${stamp()}] итог: eligible ${final?.items.length ?? 0}, rejected ${final?.rejected.length ?? 0}, ` +
      `pending ${final?.enrichQueue.length ?? 0}, emailsFound ${final?.enrichEmailsFoundTotal ?? 0}`
  );
  console.log(`Файл: data/outreach-queue.json`);
  await closeEnrichCardsWorker();
}

main().catch(async (error) => {
  console.error(error);
  await closeEnrichCardsWorker().catch(() => {});
  process.exit(1);
});
