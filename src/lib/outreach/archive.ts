import fs from "fs";
import path from "path";
import { classifyEmail } from "./email-filter";
import { normalizeDeclaration } from "./fsa";
import { isEndDateInRange } from "./queue-cleanup";
import type { FsaDeclaration, OutreachQueue, OutreachQueueItem } from "./types";

export type FsaArchive = {
  version: 1;
  /** Полный период дампа (RU dd.mm.yyyy) */
  range: { from: string; to: string };
  fetchedAt: string;
  source: "local-dump";
  declarations: FsaDeclaration[];
};

const archivePath = path.join(process.cwd(), "data", "fsa-archive.json");

export function getFsaArchivePath(): string {
  return archivePath;
}

export function readFsaArchive(): FsaArchive | null {
  if (!fs.existsSync(archivePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(archivePath, "utf-8")) as FsaArchive;
  } catch {
    return null;
  }
}

export function writeFsaArchive(archive: FsaArchive): void {
  const dir = path.dirname(archivePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2) + "\n");
}

export function filterArchiveByRange(
  archive: FsaArchive,
  range: { from: string; to: string }
): FsaDeclaration[] {
  return archive.declarations
    .map(normalizeDeclaration)
    .filter((item) => isEndDateInRange(item, range))
    .sort((a, b) => {
      const [da, ma, ya] = a.endDate.split(".").map(Number);
      const [db, mb, yb] = b.endDate.split(".").map(Number);
      return (
        new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime()
      );
    });
}

function toQueueItem(declaration: FsaDeclaration): OutreachQueueItem {
  const normalized = normalizeDeclaration(declaration);
  const { status, reason } = classifyEmail(normalized.applicant?.email);
  return {
    ...normalized,
    emailStatus: status,
    emailRejectReason: reason,
  };
}

/** Собирает рабочую очередь из архива под текущее (или заданное) окно дат. */
export function buildQueueFromArchive(
  archive: FsaArchive,
  range: { from: string; to: string },
  options?: { existing?: OutreachQueue | null }
): OutreachQueue {
  const inRange = filterArchiveByRange(archive, range);
  const withEmail = inRange.filter((item) => item.applicant?.email?.trim());
  const needsEnrich = inRange.filter((item) => !item.applicant?.email?.trim());
  const classified = withEmail.map(toQueueItem);
  const items = classified.filter((item) => item.emailStatus === "eligible");
  const rejected = classified.filter((item) => item.emailStatus === "rejected");

  const existing = options?.existing;
  const excludeMap = new Map(
    (existing?.items ?? [])
      .filter((item) => item.excludeFromAutoSend)
      .map((item) => [item.id, true] as const)
  );

  return {
    scannedAt: new Date().toISOString(),
    range,
    category: "expiring",
    paginationVersion: 2,
    nextApiPage: 0,
    apiCursor: { page: 0, sortIndex: 0, sliceIndex: 0 },
    pageSize: 100,
    hasMore: false,
    items: items.map((item) =>
      excludeMap.has(item.id) ? { ...item, excludeFromAutoSend: true } : item
    ),
    rejected,
    enrichQueue: needsEnrich,
    enrichPaused: existing?.enrichPaused ?? false,
    enrichProcessedTotal: 0,
    enrichEmailsFoundTotal: 0,
    enrichSessionInitialPending: needsEnrich.length,
  };
}
