#!/usr/bin/env tsx
/**
 * Полный дамп реестра ФСА с локальной машины (РФ, без прокси).
 *
 * По умолчанию: 14.08.2026 — 31.12.2026 → data/fsa-archive.json
 *
 *   npx tsx scripts/outreach/dump-fsa-range.ts
 *   npx tsx scripts/outreach/dump-fsa-range.ts --from 14.08.2026 --to 31.12.2026
 *
 * Прокси насильно отключается (OUTREACH_FSA_PROXY), чтобы не ходить через VPS-цепочку.
 */
import { config } from "dotenv";
import path from "path";
import { writeFsaArchive, type FsaArchive } from "../../src/lib/outreach/archive";
import { ensureFsaSession } from "../../src/lib/outreach/fsa-connection";
import { normalizeDeclaration, searchExpiringDeclarations } from "../../src/lib/outreach/fsa";
import {
  cursorNeedsRotation,
  getSortField,
  isFsaPageLimitError,
  rotateFsaCursor,
  ruDateToIso,
  splitRangeIntoSlices,
  type FsaLoadCursor,
  type RuDateRange,
} from "../../src/lib/outreach/fsa-pagination";
import { isEndDateInRange } from "../../src/lib/outreach/queue-cleanup";
import type { FsaDeclaration } from "../../src/lib/outreach/types";
import { invalidateFsaBearerToken } from "../../src/lib/outreach/bearer";

config({ path: path.join(process.cwd(), ".env.local") });

// Локальный дамп всегда direct — купленный прод-прокси здесь не нужен.
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
delete process.env.OUTREACH_FSA_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.HTTP_PROXY;

const DEFAULT_FROM = "14.08.2026";
const DEFAULT_TO = "31.12.2026";
const PAGE_SIZE = 100;
const REQUEST_GAP_MS = 400;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv: string[]): RuDateRange {
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from" && argv[i + 1]) from = argv[++i];
    if (argv[i] === "--to" && argv[i + 1]) to = argv[++i];
  }
  return { from, to };
}

function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\b401\b|\b403\b|Unauthorized|Forbidden/i.test(msg);
}

async function dumpRange(range: RuDateRange): Promise<FsaArchive> {
  const dateSlices = splitRangeIntoSlices(range, 14);
  console.log(
    `Период ${range.from} — ${range.to}, срезов: ${dateSlices.length}, pageSize=${PAGE_SIZE}`
  );

  let session = await ensureFsaSession({ skipTransportCheck: false });
  let token = session.token;
  console.log(`Токен: ${session.tokenSource}`);

  const byId = new Map<number, FsaDeclaration>();
  let cursor: FsaLoadCursor = { page: 0, sortIndex: 0, sliceIndex: 0 };
  let exhausted = false;
  let fetches = 0;
  let emptyOrDupRotations = 0;

  while (!exhausted) {
    if (cursorNeedsRotation(cursor)) {
      const rotated = rotateFsaCursor(cursor, dateSlices.length);
      if (rotated.exhausted) {
        exhausted = true;
        break;
      }
      cursor = rotated.cursor;
      continue;
    }

    const slice = dateSlices[cursor.sliceIndex] ?? dateSlices[0];
    const sortField = getSortField(cursor);
    fetches += 1;

    let batch: FsaDeclaration[] = [];
    try {
      for (let authTry = 0; authTry < 2; authTry++) {
        try {
          batch = await searchExpiringDeclarations(
            {
              endDateFrom: ruDateToIso(slice.from),
              endDateTo: ruDateToIso(slice.to),
              page: cursor.page,
              size: PAGE_SIZE,
              sort: [sortField],
            },
            token
          );
          break;
        } catch (error) {
          if (authTry === 0 && isAuthError(error)) {
            invalidateFsaBearerToken();
            session = await ensureFsaSession({ forceTokenRefresh: true });
            token = session.token;
            await sleep(500);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (isFsaPageLimitError(error)) {
        const rotated = rotateFsaCursor(cursor, dateSlices.length);
        if (rotated.exhausted) {
          exhausted = true;
          break;
        }
        cursor = rotated.cursor;
        continue;
      }
      throw error;
    }

    const before = byId.size;
    for (const raw of batch) {
      const item = normalizeDeclaration(raw);
      if (!item.id) continue;
      if (!isEndDateInRange(item, range)) continue;
      const prev = byId.get(item.id);
      // Предпочитаем запись с email, если дубль пришёл с другой сортировки.
      if (
        !prev ||
        (!prev.applicant?.email?.trim() && item.applicant?.email?.trim())
      ) {
        byId.set(item.id, item);
      }
    }
    const added = byId.size - before;

    if (fetches % 5 === 0 || added > 0) {
      console.log(
        `[${fetches}] slice ${cursor.sliceIndex + 1}/${dateSlices.length} ` +
          `${slice.from}–${slice.to} sort=${sortField} page=${cursor.page} ` +
          `batch=${batch.length} +${added} total=${byId.size}`
      );
    }

    if (batch.length === 0 || added === 0) {
      emptyOrDupRotations += 1;
      const rotated = rotateFsaCursor(cursor, dateSlices.length);
      if (rotated.exhausted) {
        exhausted = true;
        break;
      }
      cursor = rotated.cursor;
      continue;
    }

    emptyOrDupRotations = 0;
    cursor = { ...cursor, page: cursor.page + 1 };

    if (batch.length < PAGE_SIZE) {
      const rotated = rotateFsaCursor(cursor, dateSlices.length);
      if (rotated.exhausted) {
        exhausted = true;
        break;
      }
      cursor = rotated.cursor;
    }

    await sleep(REQUEST_GAP_MS);
  }

  const declarations = [...byId.values()].sort((a, b) => {
    const [da, ma, ya] = a.endDate.split(".").map(Number);
    const [db, mb, yb] = b.endDate.split(".").map(Number);
    return (
      new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime()
    );
  });

  return {
    version: 1,
    range,
    fetchedAt: new Date().toISOString(),
    source: "local-dump",
    declarations,
  };
}

async function main() {
  const range = parseArgs(process.argv.slice(2));
  console.log("Старт дампа ФСА (local direct)…");
  const archive = await dumpRange(range);
  writeFsaArchive(archive);

  const withEmail = archive.declarations.filter((d) =>
    d.applicant?.email?.trim()
  ).length;
  console.log("\nГотово.");
  console.log(`Файл: data/fsa-archive.json`);
  console.log(`Деклараций: ${archive.declarations.length}`);
  console.log(`С email в списке API: ${withEmail}`);
  console.log(
    `Без email (потом enrich/карточки): ${archive.declarations.length - withEmail}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
