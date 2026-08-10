import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import { playwrightEnv } from "./playwright-env";
import type { FsaDeclaration, OutreachCategory } from "./types";

export function getEnrichLimit(): number {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_ENRICH_LIMIT || 80), 10),
    200
  );
}

type Job = {
  items: FsaDeclaration[];
  category: OutreachCategory;
  resolve: (value: FsaDeclaration[]) => void;
  reject: (error: Error) => void;
};

type CategoryWorker = {
  worker: ChildProcessWithoutNullStreams | null;
  bootPromise: Promise<void> | null;
  lineBuf: string;
  jobs: Job[];
  active: Job | null;
};

type WorkersRuntime = {
  byCategory: Record<OutreachCategory, CategoryWorker>;
};

const globalKey = "__navicert_outreach_enrich_workers_v2__";

function emptyWorker(): CategoryWorker {
  return {
    worker: null,
    bootPromise: null,
    lineBuf: "",
    jobs: [],
    active: null,
  };
}

function workersRuntime(): WorkersRuntime {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: WorkersRuntime;
  };
  if (!g[globalKey]) {
    g[globalKey] = {
      byCategory: {
        expiring: emptyWorker(),
        expiring_certificates: emptyWorker(),
        new_registrations: emptyWorker(),
      },
    };
  }
  return g[globalKey]!;
}

function slot(category: OutreachCategory): CategoryWorker {
  const rt = workersRuntime();
  if (!rt.byCategory[category]) {
    rt.byCategory[category] = emptyWorker();
  }
  return rt.byCategory[category];
}

function scriptPath() {
  return path.join(process.cwd(), "scripts", "outreach", "enrich-applicants.mjs");
}

function failAll(category: OutreachCategory, error: Error) {
  const s = slot(category);
  if (s.active) {
    s.active.reject(error);
    s.active = null;
  }
  for (const job of s.jobs) job.reject(error);
  s.jobs = [];
}

function sendNext(category: OutreachCategory) {
  const s = slot(category);
  if (!s.worker || s.active || s.jobs.length === 0) return;
  s.active = s.jobs.shift() ?? null;
  if (!s.active) return;
  try {
    s.worker.stdin.write(
      `${JSON.stringify({ items: s.active.items, category: s.active.category })}\n`
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    s.active.reject(err);
    s.active = null;
    sendNext(category);
  }
}

function onLine(category: OutreachCategory, line: string) {
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
  const s = slot(category);
  if (!s.active) return;

  const job = s.active;
  s.active = null;

  if (payload.error && !Array.isArray(payload.declarations)) {
    job.reject(new Error(payload.error));
  } else {
    job.resolve(payload.declarations ?? []);
  }
  sendNext(category);
}

function wireWorker(
  category: OutreachCategory,
  child: ChildProcessWithoutNullStreams
) {
  const s = slot(category);
  s.worker = child;
  s.lineBuf = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    s.lineBuf += chunk;
    let nl = s.lineBuf.indexOf("\n");
    while (nl >= 0) {
      const line = s.lineBuf.slice(0, nl);
      s.lineBuf = s.lineBuf.slice(nl + 1);
      onLine(category, line);
      nl = s.lineBuf.indexOf("\n");
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  child.on("exit", (code) => {
    s.worker = null;
    s.bootPromise = null;
    failAll(
      category,
      new Error(stderr.trim() || `enrich-applicants daemon exited with ${code}`)
    );
  });
}

async function startWorker(category: OutreachCategory): Promise<void> {
  const s = slot(category);
  if (s.worker && !s.worker.killed) return;
  if (s.bootPromise) {
    await s.bootPromise;
    return;
  }

  s.bootPromise = new Promise<void>((resolve, reject) => {
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
        wireWorker(category, child);
        s.lineBuf = rest;
        let idx = s.lineBuf.indexOf("\n");
        while (idx >= 0) {
          const line = s.lineBuf.slice(0, idx);
          s.lineBuf = s.lineBuf.slice(idx + 1);
          onLine(category, line);
          idx = s.lineBuf.indexOf("\n");
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
    slot(category).bootPromise = null;
  });

  await s.bootPromise;
}

/**
 * Карточное обогащение через persistent Chromium daemon.
 * Отдельный процесс на категорию — декларации и сертификаты параллельно.
 */
export async function enrichApplicantsFromCards(
  declarations: FsaDeclaration[],
  category: OutreachCategory = "expiring"
): Promise<FsaDeclaration[]> {
  if (declarations.length === 0) return Promise.resolve([]);
  await startWorker(category);

  return new Promise<FsaDeclaration[]>((resolve, reject) => {
    const s = slot(category);
    s.jobs.push({ items: declarations, category, resolve, reject });
    sendNext(category);
  });
}

/** Закрыть демоны Chromium (после ночного прогона / тестов). */
export async function closeEnrichCardsWorker(): Promise<void> {
  const rt = workersRuntime();
  const categories: OutreachCategory[] = [
    "expiring",
    "expiring_certificates",
    "new_registrations",
  ];
  await Promise.all(
    categories.map(async (category) => {
      const s = rt.byCategory[category];
      const child = s.worker;
      s.worker = null;
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
    })
  );
}
