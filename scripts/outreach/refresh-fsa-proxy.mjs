#!/usr/bin/env node
/** Re-probe free proxies and update OUTREACH_FSA_PROXY in .env.local (for cron on VPS). */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const envPath = process.env.OUTREACH_ENV_FILE || resolve(root, ".env.local");
const findScript = resolve(root, "scripts/outreach/find-fsa-proxy.mjs");

const current = readFileSync(envPath, "utf8");
const currentMatch = current.match(/^OUTREACH_FSA_PROXY=(.+)$/m);
const currentProxy = currentMatch?.[1]?.trim();

if (currentProxy) {
  const { ProxyAgent } = await import("undici");
  try {
    const res = await fetch("https://pub.fsa.gov.ru/rds/declaration", {
      signal: AbortSignal.timeout(15_000),
      dispatcher: new ProxyAgent(currentProxy.split(",")[0].trim()),
    });
    if (res.ok || [301, 302].includes(res.status)) {
      console.log(JSON.stringify({ action: "keep", proxy: currentProxy }));
      process.exit(0);
    }
  } catch {
    // fall through to refresh
  }
  console.error("current proxy dead, searching...");
}

const probe = spawnSync(process.execPath, [findScript], {
  cwd: root,
  encoding: "utf8",
  timeout: 600_000,
});

const lastLine = probe.stdout.trim().split("\n").pop() || "";
let parsed;
try {
  parsed = JSON.parse(lastLine);
} catch {
  console.error(probe.stdout);
  console.error(probe.stderr);
  process.exit(probe.status ?? 1);
}

if (!parsed.winner) {
  console.error(JSON.stringify(parsed));
  process.exit(1);
}

const next = parsed.proxy;
let nextEnv;
if (/^OUTREACH_FSA_PROXY=/m.test(current)) {
  nextEnv = current.replace(/^OUTREACH_FSA_PROXY=.*$/m, `OUTREACH_FSA_PROXY=${next}`);
} else {
  nextEnv = `${current.trimEnd()}\nOUTREACH_FSA_PROXY=${next}\n`;
}

writeFileSync(envPath, nextEnv, "utf8");
console.log(JSON.stringify({ action: "updated", proxy: next, file: envPath }));
process.exit(2);
