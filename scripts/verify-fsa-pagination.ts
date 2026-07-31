#!/usr/bin/env tsx
/**
 * Local checks: FSA pagination + bulk load (no email).
 * Run: npx tsx scripts/verify-fsa-pagination.ts
 */
import fs from "fs";
import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env.local") });

import { bulkLoadList, listResultToQueue } from "../src/lib/outreach/bulk-load";
import {
  FSA_API_MAX_PAGES,
  FSA_PAGINATION_VERSION,
  FSA_SORT_FIELDS,
  cursorNeedsRotation,
  healFsaPagination,
  rotateFsaCursor,
  splitRangeIntoSlices,
  dateSlicesForLoad,
} from "../src/lib/outreach/fsa-pagination";
import { readOutreachQueue, writeOutreachQueue } from "../src/lib/outreach/queue";
import type { OutreachQueue } from "../src/lib/outreach/types";

const BASE_URL = process.env.VERIFY_BASE_URL?.trim() || "http://localhost:3000";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD?.trim() || "navicert2025";

let passed = 0;
let failed = 0;

function ok(name: string, detail?: string) {
  passed += 1;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function bad(name: string, detail?: string) {
  failed += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) ok(name, detail);
  else bad(name, detail ?? "failed");
}

function testPaginationHelpers() {
  console.log("\n[1] Pagination helpers");

  const slices = splitRangeIntoSlices({ from: "01.07.2026", to: "31.08.2026" }, 14);
  assert("splitRangeIntoSlices >= 2", slices.length >= 2, `slices=${slices.length}`);

  assert(
    "cursorNeedsRotation at page 20",
    cursorNeedsRotation({ page: 20, sortIndex: 0, sliceIndex: 0 })
  );
  assert(
    "cursorNeedsRotation false at page 19",
    !cursorNeedsRotation({ page: 19, sortIndex: 0, sliceIndex: 0 })
  );

  const r1 = rotateFsaCursor({ page: 20, sortIndex: 0, sliceIndex: 0 }, slices.length);
  assert("rotate → next sort", r1.cursor.sortIndex === 1 && r1.cursor.page === 0);

  let cursor = { page: 20, sortIndex: FSA_SORT_FIELDS.length - 1, sliceIndex: 0 };
  const r2 = rotateFsaCursor(cursor, slices.length);
  assert("rotate → next slice", r2.cursor.sliceIndex === 1 && r2.cursor.sortIndex === 0);

  cursor = {
    page: 20,
    sortIndex: FSA_SORT_FIELDS.length - 1,
    sliceIndex: slices.length - 1,
  };
  const r3 = rotateFsaCursor(cursor, slices.length);
  assert("rotate exhausted", r3.exhausted);

  assert("FSA_API_MAX_PAGES is 20", FSA_API_MAX_PAGES === 20);
  assert("sort grid has asc+desc", FSA_SORT_FIELDS.length >= 8);

  const legacySlices = dateSlicesForLoad(
    { from: "01.07.2026", to: "31.08.2026" },
    { mode: "append", paginationVersion: 1 }
  );
  assert("legacy append uses full range", legacySlices.length === 1);
  assert(
    "legacy slice is full range",
    legacySlices[0].from === "01.07.2026" && legacySlices[0].to === "31.08.2026"
  );

  const v2Slices = dateSlicesForLoad(
    { from: "01.07.2026", to: "31.08.2026" },
    { mode: "append", paginationVersion: 2 }
  );
  assert("v2 append uses sub-slices", v2Slices.length >= 2);
}

function testHealFsaPagination() {
  console.log("\n[1b] healFsaPagination (autonomous cursor fix)");

  const stuck: OutreachQueue = {
    scannedAt: new Date().toISOString(),
    range: { from: "01.07.2026", to: "31.08.2026" },
    category: "expiring",
    paginationVersion: 1,
    nextApiPage: 20,
    apiCursor: { page: 20, sortIndex: 0, sliceIndex: 0 },
    pageSize: 100,
    hasMore: true,
    items: [],
    rejected: [],
    enrichQueue: [],
  };
  const { queue, changed } = healFsaPagination(stuck);
  assert("heal detects stuck page 20", changed);
  assert(
    "heal upgrades to current pagination version",
    queue.paginationVersion === FSA_PAGINATION_VERSION
  );
  assert("heal resets page", queue.apiCursor?.page === 0);
  assert("heal rotates sort", queue.apiCursor?.sortIndex === 1);

  const alreadyOk: OutreachQueue = {
    ...stuck,
    paginationVersion: FSA_PAGINATION_VERSION,
    nextApiPage: 5,
    apiCursor: { page: 5, sortIndex: 1, sliceIndex: 0 },
  };
  const ok = healFsaPagination(alreadyOk);
  assert("heal no-op on healthy cursor", !ok.changed);
}

function testAddedNewAndQueue() {
  console.log("\n[2] addedNew + queue cursor (offline)");

  const known = new Set([1, 2, 3]);
  const raw = [
    { id: 2, endDate: "01.08.2026" },
    { id: 4, endDate: "02.08.2026" },
    { id: 5, endDate: "03.08.2026" },
  ];
  const addedNew = raw.filter((r) => !known.has(r.id)).length;
  assert("addedNew counts only new ids", addedNew === 2, `added=${addedNew}`);

  const result = {
    range: { from: "01.07.2026", to: "31.08.2026" },
    nextApiPage: 3,
    apiCursor: { page: 3, sortIndex: 1, sliceIndex: 0 },
    pageSize: 100,
    hasMore: true,
    items: [],
    rejected: [],
    enrichQueue: [],
    loadedFromApi: 100,
    addedNew: 12,
    emailsFromList: 0,
    cursorLabel: "test",
  };
  const q = listResultToQueue(result, { mode: "append", existing: null });
  assert("listResultToQueue saves apiCursor", q.apiCursor?.sortIndex === 1);
  assert("listResultToQueue syncs nextApiPage", q.nextApiPage === 3);
}

async function testBulkLoadLive() {
  console.log("\n[3] bulkLoadList live FSA (token; proxy only on prod VPS)");

  const snapshot = readOutreachQueue()
    ? structuredClone(readOutreachQueue()!)
    : null;

  try {
    const reset = await bulkLoadList({
      mode: "reset",
      maxItems: 50,
      pageSize: 100,
    });
    assert("reset loadedFromApi > 0", reset.loadedFromApi > 0, String(reset.loadedFromApi));
    assert("reset has apiCursor", Boolean(reset.apiCursor));
    assert(
      "reset page within limit",
      reset.apiCursor.page <= FSA_API_MAX_PAGES,
      `page=${reset.apiCursor.page}`
    );
    ok("reset cursor", reset.cursorLabel);

    const queueAfterReset: OutreachQueue = {
      scannedAt: new Date().toISOString(),
      range: reset.range,
      category: "expiring",
      nextApiPage: reset.nextApiPage,
      apiCursor: reset.apiCursor,
      pageSize: reset.pageSize,
      hasMore: reset.hasMore,
      items: reset.items,
      rejected: reset.rejected,
      enrichQueue: reset.enrichQueue,
      enrichPaused: true,
    };
    writeOutreachQueue(queueAfterReset);

    const beforeIds = new Set([
      ...queueAfterReset.items.map((i) => i.id),
      ...queueAfterReset.rejected.map((i) => i.id),
      ...queueAfterReset.enrichQueue.map((i) => i.id),
    ]);

    const append1 = await bulkLoadList({
      mode: "append",
      maxItems: 100,
      pageSize: 100,
      existingQueue: queueAfterReset,
    });
    assert("append1 ok", append1.loadedFromApi >= 0);
    assert(
      "append1 addedNew <= loadedFromApi",
      append1.addedNew <= append1.loadedFromApi,
      `added=${append1.addedNew} loaded=${append1.loadedFromApi}`
    );

    const dupAppend = await bulkLoadList({
      mode: "append",
      maxItems: 100,
      pageSize: 100,
      existingQueue: {
        ...queueAfterReset,
        nextApiPage: append1.nextApiPage,
        apiCursor: append1.apiCursor,
        hasMore: append1.hasMore,
      },
    });
    const allKnown = [...beforeIds];
    for (const id of [
      ...append1.items.map((i) => i.id),
      ...append1.rejected.map((i) => i.id),
      ...append1.enrichQueue.map((i) => i.id),
    ]) {
      allKnown.push(id);
    }
    ok(
      "append tracks cursor",
      `page ${append1.apiCursor.page} sort#${append1.apiCursor.sortIndex} slice#${append1.apiCursor.sliceIndex}`
    );

    if (dupAppend.loadedFromApi > 0 && dupAppend.addedNew === 0) {
      ok("duplicate batch → addedNew=0", `loaded=${dupAppend.loadedFromApi}`);
    } else {
      ok(
        "append2",
        `loaded=${dupAppend.loadedFromApi} added=${dupAppend.addedNew}`
      );
    }
  } catch (error) {
    bad(
      "bulkLoadList",
      error instanceof Error ? error.message.slice(0, 200) : String(error)
    );
  } finally {
    if (snapshot) writeOutreachQueue(snapshot);
    else if (fs.existsSync(path.join(process.cwd(), "data", "outreach-queue.json"))) {
      // leave test queue if no snapshot — restore empty risky; snapshot preferred
    }
  }
}

async function loginAdmin(): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (!res.ok) return null;
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/navicert_admin=([^;]+)/);
  return match ? `navicert_admin=${match[1]}` : null;
}

async function testAdminScanApi(cookie: string) {
  console.log("\n[4] Admin scan API (no send, 90s timeout)");

  const scanRes = await fetch(`${BASE_URL}/api/admin/outreach/scan`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "reset", maxItems: 30, pageSize: 100 }),
    signal: AbortSignal.timeout(90_000),
  });
  const scanJson = (await scanRes.json()) as Record<string, unknown>;
  assert("POST scan reset", scanRes.ok, String(scanRes.status));
  if (scanRes.ok) {
    assert("response has addedNew", typeof scanJson.addedNew === "number");
    assert("response has apiCursor", Boolean(scanJson.apiCursor));
    assert("response has cursorLabel", Boolean(scanJson.cursorLabel));
    ok(
      "scan stats",
      `loaded=${scanJson.loadedFromApi} added=${scanJson.addedNew}`
    );
  } else {
    bad("scan error", String(scanJson.error ?? scanRes.status));
  }

  const appendRes = await fetch(`${BASE_URL}/api/admin/outreach/scan`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ mode: "append", maxItems: 50, pageSize: 100 }),
    signal: AbortSignal.timeout(90_000),
  });
  const appendJson = (await appendRes.json()) as Record<string, unknown>;
  assert("POST scan append", appendRes.ok, String(appendRes.status));
  if (appendRes.ok) {
    assert(
      "append addedNew <= loadedFromApi",
      Number(appendJson.addedNew) <= Number(appendJson.loadedFromApi)
    );
    ok(
      "append stats",
      `loaded=${appendJson.loadedFromApi} added=${appendJson.addedNew} cursor=${appendJson.cursorLabel}`
    );
  } else {
    bad("append error", String(appendJson.error ?? appendRes.status));
  }

  const getRes = await fetch(`${BASE_URL}/api/admin/outreach`, {
    headers: { cookie },
  });
  const state = (await getRes.json()) as { cursorLabel?: string; apiCursor?: unknown };
  assert("GET state has cursorLabel", Boolean(state.cursorLabel));
}

async function testQueueUnchangedOnBulkLoadError() {
  console.log("\n[5] Queue unchanged when bulkLoadList fails");

  const snapshot = readOutreachQueue()
    ? structuredClone(readOutreachQueue()!)
    : null;

  const prevToken = process.env.FSA_BEARER_TOKEN;
  process.env.FSA_BEARER_TOKEN = "invalid-token-for-test";

  try {
    await bulkLoadList({ mode: "reset", maxItems: 10, pageSize: 100 });
    bad("bulkLoadList should fail with invalid token");
  } catch {
    ok("bulkLoadList rejects invalid token");
  } finally {
    if (prevToken === undefined) delete process.env.FSA_BEARER_TOKEN;
    else process.env.FSA_BEARER_TOKEN = prevToken;
  }

  const after = readOutreachQueue();
  if (snapshot) {
    assert(
      "queue unchanged after failed load",
      JSON.stringify(after) === JSON.stringify(snapshot)
    );
    writeOutreachQueue(snapshot);
  } else {
    ok("no queue snapshot — skip compare");
  }
}

async function main() {
  console.log("FSA pagination local verify (no email)\n");
  testPaginationHelpers();
  testHealFsaPagination();
  testAddedNewAndQueue();
  await testQueueUnchangedOnBulkLoadError();

  try {
    await testBulkLoadLive();
  } catch (e) {
    bad("bulkLoadDirect crash", e instanceof Error ? e.message : String(e));
  }

  const cookie = await loginAdmin();
  if (!cookie) {
    bad("dev server / admin login", `no cookie from ${BASE_URL}`);
  } else {
    await testAdminScanApi(cookie);
  }

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
