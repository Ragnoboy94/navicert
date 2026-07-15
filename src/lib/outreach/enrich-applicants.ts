import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import { playwrightEnv } from "./playwright-env";
import type { FsaDeclaration } from "./types";

export function getEnrichLimit(): number {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_ENRICH_LIMIT || 80), 10),
    200
  );
}

type Job = {
  items: FsaDeclaration[];
  resolve: (value: FsaDeclaration[]) => void;
  reject: (error: Error) => void;
};

let worker: ChildProcessWithoutNullStreams | null = null;
let bootPromise: Promise<void> | null = null;
let lineBuf = "";
let jobs: Job[] = [];
let active: Job | null = null;

function scriptPath() {
  return path.join(process.cwd(), "scripts", "outreach", "enrich-applicants.mjs");
}

function failAll(error: Error) {
  if (active) {
    active.reject(error);
    active = null;
  }
  for (const job of jobs) job.reject(error);
  jobs = [];
}

function sendNext() {
  if (!worker || active || jobs.length === 0) return;
  active = jobs.shift() ?? null;
  if (!active) return;
  try {
    worker.stdin.write(`${JSON.stringify({ items: active.items })}\n`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    active.reject(err);
    active = null;
    sendNext();
  }
}

function onLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let payload: {
    ready?: boolean;
    declarations?: FsaDeclaration[];
    error?: string;
  };
  try {
    payload = JSON.parse(trimmed) as typeof payload;
  } catch {
    return;
  }

  if (payload.ready) return;
  if (!active) return;

  const job = active;
  active = null;

  if (payload.error && !Array.isArray(payload.declarations)) {
    job.reject(new Error(payload.error));
  } else {
    job.resolve(payload.declarations ?? []);
  }
  sendNext();
}

function wireWorker(child: ChildProcessWithoutNullStreams) {
  worker = child;
  lineBuf = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    lineBuf += chunk;
    let nl = lineBuf.indexOf("\n");
    while (nl >= 0) {
      const line = lineBuf.slice(0, nl);
      lineBuf = lineBuf.slice(nl + 1);
      onLine(line);
      nl = lineBuf.indexOf("\n");
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  child.on("exit", (code) => {
    worker = null;
    bootPromise = null;
    failAll(
      new Error(stderr.trim() || `enrich-applicants daemon exited with ${code}`)
    );
  });
}

async function startWorker(): Promise<void> {
  if (worker && !worker.killed) return;
  if (bootPromise) {
    await bootPromise;
    return;
  }

  bootPromise = new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath(), "--daemon"], {
      cwd: process.cwd(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: playwrightEnv(),
    }) as ChildProcessWithoutNullStreams;

    let settled = false;
    let buf = "";

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(error);
    };

    const onBootData = (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const first = buf.slice(0, nl);
      const rest = buf.slice(nl + 1);
      try {
        const payload = JSON.parse(first) as { ready?: boolean };
        if (!payload.ready) return;
        child.stdout.off("data", onBootData);
        settled = true;
        wireWorker(child);
        lineBuf = rest;
        let idx = lineBuf.indexOf("\n");
        while (idx >= 0) {
          const line = lineBuf.slice(0, idx);
          lineBuf = lineBuf.slice(idx + 1);
          onLine(line);
          idx = lineBuf.indexOf("\n");
        }
        resolve();
      } catch {
        // keep waiting for ready line
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onBootData);
    child.on("error", (error) =>
      fail(error instanceof Error ? error : new Error(String(error)))
    );
    child.on("exit", (code) => {
      if (!settled) fail(new Error(`daemon failed to start (${code})`));
    });
    setTimeout(() => fail(new Error("daemon start timeout")), 60_000);
  }).finally(() => {
    bootPromise = null;
  });

  await bootPromise;
}

/**
 * Карточное обогащение через persistent Chromium daemon
 * (один браузер на всю сессию, без перезапуска на каждый батч).
 */
export async function enrichApplicantsFromCards(
  declarations: FsaDeclaration[]
): Promise<FsaDeclaration[]> {
  if (declarations.length === 0) return Promise.resolve([]);
  await startWorker();

  return new Promise<FsaDeclaration[]>((resolve, reject) => {
    jobs.push({ items: declarations, resolve, reject });
    sendNext();
  });
}

/** Закрыть демон Chromium (после ночного прогона / тестов). */
export async function closeEnrichCardsWorker(): Promise<void> {
  const child = worker;
  worker = null;
  if (!child) return;
  try {
    child.stdin.write(`${JSON.stringify({ cmd: "shutdown" })}\n`);
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
