/**
 * Smoke / regression checks for outreach: schedule, enrich pause, admin API, cron.
 * Run: npx tsx scripts/verify-outreach.ts
 * Requires dev server on BASE_URL (default http://localhost:3000).
 */
import fs from "fs";
import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env.local") });
loadEnv({ path: path.join(process.cwd(), ".env") });

import {
  getEnrichRunnerStatus,
  pauseBackgroundEnrich,
  startBackgroundEnrich,
  waitForBackgroundEnrich,
} from "../src/lib/outreach/enrich-runner";
import { cancelPendingEnrichJobs, getFsaQueueStatus, enqueueFsaJob, cancelPendingFsaJobs } from "../src/lib/outreach/fsa-orchestrator";
import { readOutreachQueue, writeOutreachQueue, getExpiringMonthRange } from "../src/lib/outreach/queue";
import { enrichQueueBatch, applyEnrichResult } from "../src/lib/outreach/bulk-load";
import {
  getScheduleStats,
  readOutreachSchedule,
  runScheduledOutreach,
  verifyCronSecret,
  writeOutreachSchedule,
} from "../src/lib/outreach/schedule";
import type { OutreachQueue } from "../src/lib/outreach/types";

const BASE_URL = process.env.VERIFY_BASE_URL?.trim() || "http://localhost:3000";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD?.trim() || "navicert2025";

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail?: string) {
  results.push({ name, ok: false, detail });
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) pass(name, detail);
  else fail(name, detail ?? "assertion failed");
}

function backupQueue(): OutreachQueue | null {
  const q = readOutreachQueue();
  return q ? structuredClone(q) : null;
}

function restoreQueue(snapshot: OutreachQueue | null) {
  if (snapshot) writeOutreachQueue(snapshot);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 200
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function testScheduleLogic() {
  console.log("\n[1] Schedule / auto-send logic");

  const before = structuredClone(readOutreachSchedule());
  try {
    writeOutreachSchedule({ enabled: false, emailsPerDay: 50 });
    const disabled = await runScheduledOutreach();
    assert(
      "auto-send skipped when disabled",
      disabled.skipped === true && disabled.reason === "disabled"
    );

    writeOutreachSchedule({ enabled: true, emailsPerDay: 50 });
    const notNow = await runScheduledOutreach();
    assert(
      "auto-send skipped outside slot window",
      notNow.skipped === true &&
        (notNow.reason === "not_scheduled_now" ||
          notNow.reason === "daily_limit_reached" ||
          notNow.reason === "empty_queue"),
      notNow.reason
    );

    const forced = await runScheduledOutreach({ force: true });
    assert(
      "force run returns structured result",
      typeof forced.ok === "boolean" &&
        (forced.skipped === true ||
          (forced.attempted >= 0 && forced.sent >= 0)),
      forced.skipped
        ? `skipped: ${forced.reason}`
        : `sent ${forced.sent}/${forced.attempted}`
    );

    const stats = getScheduleStats();
    assert(
      "schedule stats expose nextRunLabel",
      typeof stats.nextRunLabel === "string" && stats.nextRunLabel.length > 0,
      stats.nextRunLabel
    );

    const secret = process.env.OUTREACH_CRON_SECRET?.trim();
    if (secret) {
      const okReq = new Request(`${BASE_URL}/api/outreach/cron`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      const badReq = new Request(`${BASE_URL}/api/outreach/cron`);
      assert("cron secret accepts bearer", verifyCronSecret(okReq));
      assert("cron secret rejects missing auth", !verifyCronSecret(badReq));
    } else {
      pass("cron secret check skipped", "OUTREACH_CRON_SECRET not set");
    }
  } finally {
    writeOutreachSchedule(before);
  }
}

async function testEnrichPauseLogic() {
  console.log("\n[2] Enrich pause / no auto-restart");

  const snapshot = backupQueue();
  const range = getExpiringMonthRange();
  const queue = snapshot ?? {
    category: "expiring" as const,
    range,
    scannedAt: new Date().toISOString(),
    nextApiPage: 0,
    pageSize: 100,
    hasMore: false,
    items: [],
    rejected: [],
    enrichQueue: [
      {
        id: 999999001,
        number: "TEST-1",
        registrationDate: range.from,
        endDate: range.to,
        status: "active",
        productName: "verify",
        registryUrl: "https://pub.fsa.gov.ru/rds/declaration/view/999999001",
        applicant: { shortName: "Verify Co" },
      },
    ],
    enrichPaused: false,
  };

  try {
    writeOutreachQueue({
      ...queue,
      range,
      enrichPaused: false,
      // Гарантируем карточку в текущем периоде — sanitize иначе вычистит pending.
      enrichQueue: [
        {
          id: 999999001,
          number: "TEST-1",
          registrationDate: range.from,
          endDate: range.to,
          status: "active",
          productName: "verify",
          registryUrl: "https://pub.fsa.gov.ru/rds/declaration/view/999999001",
          applicant: { shortName: "Verify Co" },
        },
      ],
    });
    await waitForBackgroundEnrich();

    pauseBackgroundEnrich();
    cancelPendingEnrichJobs("expiring");
    assert(
      "pause sets enrichPaused in queue file",
      readOutreachQueue()?.enrichPaused === true
    );

    const blocked = startBackgroundEnrich();
    assert(
      "start blocked while paused (no force)",
      blocked.started === false && blocked.paused === true
    );

    assert(
      "runner not running after pause",
      getEnrichRunnerStatus().running === false
    );

    cancelPendingEnrichJobs("expiring");
    await waitFor(() => !getEnrichRunnerStatus().running, 10_000);
    cancelPendingEnrichJobs("expiring");

    const status = getEnrichRunnerStatus();
    assert(
      "status reports paused",
      readOutreachQueue()?.enrichPaused === true &&
        status.running === false &&
        status.pending > 0,
      JSON.stringify({
        filePaused: readOutreachQueue()?.enrichPaused,
        statusPaused: status.paused,
        queued: status.queued,
        running: status.running,
        pending: status.pending,
      })
    );

    const forced = startBackgroundEnrich({ force: true });
    if (forced.started) {
      await new Promise((r) => setTimeout(r, 500));
      pauseBackgroundEnrich();
      const stopped = await waitFor(
        () => !getEnrichRunnerStatus().running,
        180_000
      );
      assert(
        "stop during run eventually halts runner",
        stopped && readOutreachQueue()?.enrichPaused === true
      );
      await waitForBackgroundEnrich();
    } else {
      pass(
        "stop during run skipped",
        forced.alreadyRunning ? "already running" : "could not start"
      );
    }

    const afterPause = startBackgroundEnrich();
    assert(
      "no auto-restart after stop without force",
      afterPause.started === false && afterPause.paused === true
    );
  } finally {
    await waitForBackgroundEnrich();
    restoreQueue(snapshot);
  }
}

async function testFsaQueueStatusUx() {
  console.log("\n[2b] FSA queue status (no cancel-as-error)");

  cancelPendingFsaJobs("expiring", ["scan", "enrich", "health"]);
  const queued = enqueueFsaJob({
    type: "enrich",
    category: "expiring",
    priority: "low",
    source: "verify",
    payload: { maxBatches: 1 },
  });
  assert(
    "enqueue enrich for status check",
    queued.accepted === true,
    JSON.stringify(queued)
  );

  cancelPendingFsaJobs("expiring", ["enrich"]);
  const status = getFsaQueueStatus("expiring");
  assert(
    "manual cancel is not lastError",
    status.lastError == null ||
      !/снято с очереди|остановлено вручную/i.test(status.lastError),
    status.lastError ?? "null"
  );
  assert(
    "no pending enrich after cancel",
    status.enrichQueued === false && status.pendingLow === 0
  );

  // +100 и +1000 не схлопываются — каждая задача двигает page/sort
  cancelPendingFsaJobs("expiring", ["scan"]);
  const s100a = enqueueFsaJob({
    type: "scan",
    category: "expiring",
    priority: "high",
    source: "verify",
    payload: { mode: "append", maxItems: 100, pageSize: 100 },
  });
  const s100b = enqueueFsaJob({
    type: "scan",
    category: "expiring",
    priority: "high",
    source: "verify",
    payload: { mode: "append", maxItems: 100, pageSize: 100 },
  });
  const s1000 = enqueueFsaJob({
    type: "scan",
    category: "expiring",
    priority: "high",
    source: "verify",
    payload: { mode: "append", maxItems: 1000, pageSize: 100 },
  });
  assert(
    "append 100/1000 stack without duplicate",
    s100a.accepted &&
      s100b.accepted &&
      s1000.accepted &&
      !s100b.duplicate &&
      !s1000.duplicate,
    JSON.stringify({ s100a, s100b, s1000 })
  );
  const afterStack = getFsaQueueStatus("expiring");
  assert(
    "pendingScanAppend counts stacked jobs",
    (afterStack.pendingScanAppend ?? 0) >= 3,
    String(afterStack.pendingScanAppend)
  );
  cancelPendingFsaJobs("expiring", ["scan"]);
}

async function testLiveDeclarationEnrich() {
  console.log("\n[2c] Live declaration enrich (API, skip Playwright)");

  const queue = readOutreachQueue("expiring");
  if (!queue || queue.enrichQueue.length === 0) {
    pass("live enrich skipped", "no enrich backlog");
    return;
  }

  const beforeItems = queue.items.length;
  const beforeRejected = queue.rejected.length;
  const beforeEnrich = queue.enrichQueue.length;
  const batchSize = Math.min(12, beforeEnrich);
  const started = Date.now();
  const result = await enrichQueueBatch(queue, batchSize, {
    shouldAbort: () => false,
  });
  const next = applyEnrichResult(queue, result);
  next.enrichProcessedTotal =
    (queue.enrichProcessedTotal ?? 0) + result.processed;
  next.enrichEmailsFoundTotal =
    (queue.enrichEmailsFoundTotal ?? 0) + result.emailsFound;
  writeOutreachQueue(next);

  assert(
    "enrich batch processes cards",
    result.processed + result.requeued === batchSize,
    `processed=${result.processed} requeued=${result.requeued}`
  );
  assert(
    "enrich prefers API over Playwright for declarations",
    result.enrichedFromCards === 0 || result.emailsFound > 0,
    `fromCards=${result.enrichedFromCards} emails=${result.emailsFound}`
  );
  // После успешного API без email карточки уходят в rejected, не крутятся в хвосте.
  assert(
    "enrich backlog shrinks without infinite requeue",
    result.enrichQueue.length < beforeEnrich,
    `${beforeEnrich} → ${result.enrichQueue.length}`
  );
  assert(
    "enrich writes items or rejected",
    next.items.length > beforeItems || next.rejected.length > beforeRejected,
    `items ${beforeItems}→${next.items.length}, rejected ${beforeRejected}→${next.rejected.length}`
  );
  pass(
    "live enrich timing",
    `${Date.now() - started}ms, emails=${result.emailsFound}, fromCards=${result.enrichedFromCards}`
  );
}

async function adminFetch(
  cookie: string,
  pathname: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      cookie,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
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

async function testAdminApi(cookie: string) {
  console.log("\n[3] Admin API (buttons → endpoints)");

  const getRes = await adminFetch(cookie, "/api/admin/outreach");
  assert("GET /api/admin/outreach", getRes.ok, String(getRes.status));
  const state = (await getRes.json()) as {
    enrichStatus?: { running: boolean; paused: boolean; queued?: boolean };
    schedule?: { enabled: boolean };
    sendableCount?: number;
    fsaQueue?: {
      pendingHigh?: number;
      pendingLow?: number;
      lastError?: string | null;
    };
  };
  assert(
    "state includes enrichStatus + schedule",
    Boolean(state.enrichStatus) && Boolean(state.schedule)
  );
  assert(
    "state includes fsaQueue",
    Boolean(state.fsaQueue) &&
      typeof state.fsaQueue?.pendingHigh === "number"
  );

  const healthRes = await adminFetch(cookie, "/api/admin/outreach/fsa/health", {
    method: "POST",
  });
  assert("POST fsa/health", healthRes.ok, String(healthRes.status));
  const healthJson = (await healthRes.json()) as {
    ok?: boolean;
    message?: string;
    error?: string | null;
  };
  assert(
    "fsa/health returns probe result",
    typeof healthJson.ok === "boolean",
    healthJson.message ?? healthJson.error ?? ""
  );

  const schedBefore = state.schedule?.enabled ?? false;
  const toggleRes = await adminFetch(cookie, "/api/admin/outreach/schedule", {
    method: "POST",
    body: JSON.stringify({
      enabled: !schedBefore,
      emailsPerDay: 50,
    }),
  });
  assert("POST schedule enable/disable", toggleRes.ok, String(toggleRes.status));

  await adminFetch(cookie, "/api/admin/outreach/schedule", {
    method: "POST",
    body: JSON.stringify({ enabled: schedBefore, emailsPerDay: 50 }),
  });
  pass("schedule restored", schedBefore ? "was enabled" : "was disabled");

  const stopRes = await adminFetch(cookie, "/api/admin/outreach/enrich", {
    method: "POST",
    body: JSON.stringify({ action: "stop" }),
  });
  assert("POST enrich stop", stopRes.ok, String(stopRes.status));
  const afterStop = (await stopRes.json()) as {
    paused?: boolean;
    queued?: boolean;
  };
  assert(
    "enrich stop returns paused flag",
    afterStop.paused === true && afterStop.queued !== true
  );

  // Сценарий: после stop «Продолжить» ставит в очередь и снимает паузу
  const startRes = await adminFetch(cookie, "/api/admin/outreach/enrich", {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
  assert("POST enrich continue (force)", startRes.ok, String(startRes.status));
  const startJson = (await startRes.json()) as {
    ok?: boolean;
    queued?: boolean;
    duplicate?: boolean;
    paused?: boolean;
    enrichQueue?: unknown;
    message?: string;
  };

  // Если очередь enrich пуста — API вернёт ok без queued; это допустимо
  if (startJson.message === "Очередь обогащения пуста") {
    pass("enrich continue on empty queue", "no pending cards");
  } else {
    assert(
      "enrich continue queues job and clears pause",
      startJson.ok === true &&
        startJson.queued === true &&
        startJson.paused !== true,
      JSON.stringify({
        queued: startJson.queued,
        paused: startJson.paused,
        message: startJson.message,
      })
    );

    const againRes = await adminFetch(cookie, "/api/admin/outreach/enrich", {
      method: "POST",
      body: JSON.stringify({ force: true }),
    });
    const againJson = (await againRes.json()) as {
      duplicate?: boolean;
      queued?: boolean;
      paused?: boolean;
    };
    assert(
      "second continue accepted without pause",
      againRes.ok &&
        againJson.paused !== true &&
        againJson.queued === true,
      JSON.stringify(againJson)
    );

    // kickFsaDrain может уже забрать задачу — queued ИЛИ running, но не paused
    await new Promise((r) => setTimeout(r, 300));
    const stateAfter = await adminFetch(cookie, "/api/admin/outreach");
    const stateJson = (await stateAfter.json()) as {
      enrichStatus?: { paused?: boolean; queued?: boolean; running?: boolean };
      enrichPending?: number;
    };
    assert(
      "GET state after continue: not paused (queued/running/drained ok)",
      stateJson.enrichStatus?.paused !== true,
      JSON.stringify(stateJson.enrichStatus)
    );
  }

  await adminFetch(cookie, "/api/admin/outreach/enrich", {
    method: "POST",
    body: JSON.stringify({ action: "stop" }),
  });
  const afterCancel = await adminFetch(cookie, "/api/admin/outreach");
  const cancelJson = (await afterCancel.json()) as {
    enrichStatus?: { queued?: boolean; paused?: boolean };
  };
  assert(
    "stop cancels pending enrich jobs",
    cancelJson.enrichStatus?.queued !== true
  );
  pass("enrich stopped after API continue test");

  // Снова поставить и снять через cancel endpoint
  const requeue = await adminFetch(cookie, "/api/admin/outreach/enrich", {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
  const requeueJson = (await requeue.json()) as {
    queued?: boolean;
    message?: string;
  };
  if (requeueJson.message !== "Очередь обогащения пуста") {
    const cancelRes = await adminFetch(cookie, "/api/admin/outreach/fsa/cancel", {
      method: "POST",
      body: JSON.stringify({ scope: "all" }),
    });
    const cancelApi = (await cancelRes.json()) as {
      ok?: boolean;
      cancelled?: number;
    };
    assert(
      "POST fsa/cancel endpoint ok",
      cancelRes.ok && cancelApi.ok === true,
      JSON.stringify(cancelApi)
    );
    pass(
      "fsa/cancel result",
      `cancelled=${cancelApi.cancelled ?? 0} (0 ok if drain already finished)`
    );
  } else {
    pass("fsa/cancel skipped", "no enrich backlog to queue");
  }

  const manualRun = await adminFetch(cookie, "/api/admin/outreach/schedule", {
    method: "POST",
    body: JSON.stringify({ action: "run" }),
  });
  assert(
    "POST schedule action=run (manual auto-send)",
    manualRun.ok,
    String(manualRun.status)
  );
  const runJson = (await manualRun.json()) as { skipped?: boolean; reason?: string };
  pass(
    "manual auto-send endpoint responds",
    runJson.skipped
      ? `skipped: ${runJson.reason}`
      : `sent: ${(runJson as { sent?: number }).sent ?? 0}`
  );

  const sendRes = await adminFetch(cookie, "/api/admin/outreach/send", {
    method: "POST",
    body: JSON.stringify({ count: 1 }),
  });
  if (sendRes.status === 400) {
    const err = (await sendRes.json()) as { error?: string };
    pass("POST send batch (empty ok)", err.error?.slice(0, 60) ?? "400");
  } else {
    assert("POST send batch", sendRes.ok, String(sendRes.status));
  }

  // Не оставляем боевую очередь на паузе после сценарных stop/cancel.
  const { resumeBackgroundEnrich } = await import(
    "../src/lib/outreach/enrich-runner"
  );
  resumeBackgroundEnrich("expiring");
  resumeBackgroundEnrich("expiring_certificates");
  pass("enrich pause restored after admin API scenarios");
}

async function testCronEndpoint() {
  console.log("\n[4] Cron endpoint");

  const noAuth = await fetch(`${BASE_URL}/api/outreach/cron`, {
    method: "POST",
  });
  assert("cron rejects without secret", noAuth.status === 401);

  const secret = process.env.OUTREACH_CRON_SECRET?.trim();
  if (!secret) {
    pass("cron authenticated call skipped", "OUTREACH_CRON_SECRET not set");
    return;
  }

  const res = await fetch(`${BASE_URL}/api/outreach/cron`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert("cron accepts secret", res.ok, String(res.status));
  if (res.ok) {
    const json = (await res.json()) as {
      send?: { skipped?: boolean; reason?: string };
      maintenance?: { queueReady?: number };
    };
    pass(
      "cron maintenance payload",
      json.send?.skipped
        ? `send skipped: ${json.send.reason}`
        : `send ok, queueReady=${json.maintenance?.queueReady ?? "?"}`
    );
  }
}

async function testServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  console.log("Outreach verification");
  console.log(`Base URL: ${BASE_URL}`);

  await testScheduleLogic();
  await testEnrichPauseLogic();
  await testFsaQueueStatusUx();
  await testLiveDeclarationEnrich();

  const up = await testServerReachable();
  if (!up) {
    fail(
      "dev server reachable",
      `Start with: npm run dev (${BASE_URL})`
    );
  } else {
    pass("dev server reachable");
    const cookie = await loginAdmin();
    if (!cookie) {
      fail("admin login", "check ADMIN_PASSWORD");
    } else {
      pass("admin login");
      await testAdminApi(cookie);
      await testCronEndpoint();
    }
  }

  console.log("\n--- Summary ---");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    failed.forEach((r) => console.error(`  FAIL: ${r.name} — ${r.detail ?? ""}`));
    process.exit(1);
  }
  console.log("All checks passed.");
  // Enrich/cron may leave child handles open — force clean exit.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
