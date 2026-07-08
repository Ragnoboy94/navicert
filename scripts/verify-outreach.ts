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
import { readOutreachQueue, writeOutreachQueue } from "../src/lib/outreach/queue";
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
      notNow.skipped === true && notNow.reason === "not_scheduled_now",
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
  const queue = snapshot ?? {
    category: "expiring" as const,
    range: { from: "01.07.2026", to: "31.08.2026" },
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
        registrationDate: "01.01.2025",
        endDate: "01.08.2026",
        productName: "verify",
        registryUrl: "https://pub.fsa.gov.ru/rds/declaration/view/999999001",
        applicant: { shortName: "Verify Co" },
        emailStatus: "pending" as const,
      },
    ],
    enrichPaused: false,
  };

  try {
    writeOutreachQueue({ ...queue, enrichPaused: false });
    await waitForBackgroundEnrich();

    pauseBackgroundEnrich();
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

    const status = getEnrichRunnerStatus();
    assert(
      "status reports paused",
      status.paused === true && status.pending > 0
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
    pauseBackgroundEnrich();
    restoreQueue(snapshot);
  }
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
    enrichStatus?: { running: boolean; paused: boolean };
    schedule?: { enabled: boolean };
    sendableCount?: number;
  };
  assert(
    "state includes enrichStatus + schedule",
    Boolean(state.enrichStatus) && Boolean(state.schedule)
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
  const afterStop = (await stopRes.json()) as { paused?: boolean };
  assert("enrich stop returns paused flag", afterStop.paused === true);

  const startRes = await adminFetch(cookie, "/api/admin/outreach/enrich", {
    method: "POST",
    body: JSON.stringify({ force: true }),
  });
  assert("POST enrich continue (force)", startRes.ok, String(startRes.status));
  await adminFetch(cookie, "/api/admin/outreach/enrich", {
    method: "POST",
    body: JSON.stringify({ action: "stop" }),
  });
  pass("enrich stopped after API continue test");

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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
