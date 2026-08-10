import fs from "fs";
import path from "path";
import { listResultToQueue, bulkLoadList, enrichQueueBatch, applyEnrichResult } from "./bulk-load";
import { probeFsaTransport } from "./fsa-network";
import { readOutreachQueue, writeOutreachQueue } from "./queue";
import {
  isCheckoBlocked,
  getCheckoBlockReason,
  markCheckoBlocked,
} from "./checko-guard";
import type { OutreachCategory } from "./types";

type FsaJobPriority = "high" | "low";
type FsaJobType = "scan" | "enrich" | "health";
type FsaJobStatus = "pending" | "running" | "done" | "failed";

type FsaJobBase = {
  id: string;
  type: FsaJobType;
  priority: FsaJobPriority;
  category: OutreachCategory;
  status: FsaJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  source?: string;
  summary?: string;
  error?: string;
};

type FsaScanPayload = {
  mode: "reset" | "append";
  maxItems: number;
  pageSize: number;
};

type FsaJob =
  | (FsaJobBase & { type: "scan"; payload: FsaScanPayload })
  | (FsaJobBase & { type: "enrich"; payload?: { maxBatches?: number } })
  | (FsaJobBase & { type: "health"; payload?: Record<string, never> });

type FsaOrchestratorState = {
  jobs: FsaJob[];
  running: boolean;
  updatedAt: string;
};

type EnqueueOptions = {
  type: FsaJobType;
  category: OutreachCategory;
  priority: FsaJobPriority;
  source?: string;
  payload?: FsaScanPayload | { maxBatches?: number };
};

function jobsPath(): string {
  return path.join(process.cwd(), "data", "outreach-fsa-jobs.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function readState(): FsaOrchestratorState {
  const fpath = jobsPath();
  if (!fs.existsSync(fpath)) {
    return { jobs: [], running: false, updatedAt: nowIso() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fpath, "utf-8")) as FsaOrchestratorState;
    return {
      jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
      running: Boolean(raw.running),
      updatedAt: raw.updatedAt || nowIso(),
    };
  } catch {
    return { jobs: [], running: false, updatedAt: nowIso() };
  }
}

function writeState(state: FsaOrchestratorState): void {
  const fpath = jobsPath();
  const dir = path.dirname(fpath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    fpath,
    JSON.stringify({ ...state, updatedAt: nowIso() }, null, 2) + "\n"
  );
}

/** Если процесс умер mid-job, running остаётся true и drain навсегда молчит. */
function recoverStaleLock(state: FsaOrchestratorState): FsaOrchestratorState {
  const hasRunningJob = state.jobs.some((job) => job.status === "running");

  // Lock «сирота»: running=true, а ни одна задача не running — drain вечно no-op.
  if (state.running && !hasRunningJob) {
    return { ...state, running: false, updatedAt: nowIso() };
  }

  // Обратная сирота: задача running, а глобальный lock сброшен параллельным drain.
  // Иначе UI показывает «0 срочных» и «не идёт», хотя работа жива.
  if (!state.running && hasRunningJob) {
    return { ...state, running: true, updatedAt: nowIso() };
  }

  if (!state.running) return state;

  // С heartbeat раз в ~20с: 8 мин без обновления = зависший lock.
  const STALE_MS = 8 * 60 * 1000;
  const updatedAt = Date.parse(state.updatedAt);
  const staleByTime =
    !Number.isFinite(updatedAt) || Date.now() - updatedAt > STALE_MS;

  // Живой drain обновляет updatedAt при старте/финише и heartbeat.
  // Если running давно без обновлений — lock мёртвый.
  if (!staleByTime) return state;

  return {
    ...state,
    running: false,
    updatedAt: nowIso(),
    jobs: state.jobs.map((job) =>
      job.status === "running"
        ? {
            ...job,
            status: "pending" as const,
            startedAt: undefined,
            error: undefined,
          }
        : job
    ),
  };
}

function readStateRecovered(): FsaOrchestratorState {
  const raw = readState();
  const recovered = recoverStaleLock(raw);
  if (recovered !== raw) {
    writeState(recovered);
  }
  return recovered;
}

function trimHistory(jobs: FsaJob[]): FsaJob[] {
  const done = jobs.filter((job) => job.status === "done" || job.status === "failed");
  const active = jobs.filter((job) => job.status === "pending" || job.status === "running");
  const recentDone = done.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  return [...active, ...recentDone].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function makeId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isDuplicatePending(state: FsaOrchestratorState, options: EnqueueOptions): FsaJob | null {
  for (const job of state.jobs) {
    if (job.status !== "pending" && job.status !== "running") continue;
    if (job.type !== options.type) continue;
    if (job.category !== options.category) continue;

    if (job.type === "scan" && options.type === "scan") {
      const incoming = options.payload as FsaScanPayload | undefined;
      // append (+100 / +1000): можно ставить пачкой. Каждая задача при старте
      // читает актуальный apiCursor (page/sort/slice) из очереди и двигает дальше.
      // Схлопываем только повторный reset, пока первая полная загрузка ждёт/идёт.
      if (incoming?.mode === "append") continue;
      if (job.payload.mode === "reset") return job;
      continue;
    }
    return job;
  }
  return null;
}

const MAX_PENDING_APPEND_SCANS = 20;

function countPendingAppendScans(
  state: FsaOrchestratorState,
  category: OutreachCategory
): number {
  return state.jobs.filter(
    (job) =>
      job.status === "pending" &&
      job.type === "scan" &&
      job.category === category &&
      job.payload.mode === "append"
  ).length;
}

function priorityWeight(priority: FsaJobPriority): number {
  return priority === "high" ? 2 : 1;
}

function pickNextJob(jobs: FsaJob[]): FsaJob | null {
  const pending = jobs.filter((job) => job.status === "pending");
  if (pending.length === 0) return null;
  pending.sort((a, b) => {
    const p = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (p !== 0) return p;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return pending[0];
}

async function runScanJob(job: Extract<FsaJob, { type: "scan" }>): Promise<string> {
  // Важно: очередь читаем в момент запуска, не из payload —
  // предыдущий scan уже мог сдвинуть page/sort/slice.
  const existing =
    job.payload.mode === "append" ? readOutreachQueue(job.category) : null;
  const result = await bulkLoadList({
    mode: job.payload.mode,
    maxItems: job.payload.maxItems,
    pageSize: job.payload.pageSize,
    existingQueue: existing,
    range: job.payload.mode === "append" ? existing?.range : undefined,
    category: job.category,
  });
  writeOutreachQueue(
    listResultToQueue(result, {
      mode: job.payload.mode,
      existing: existing ?? undefined,
      category: job.category,
    })
  );
  if (result.enrichQueue.length > 0) {
    enqueueFsaJob({
      type: "enrich",
      category: job.category,
      priority: "low",
      source: "scan_followup",
      // checko: 1 сессия (~десяток карточек с паузами), дальше continue.
      payload: {
        maxBatches: job.category === "new_registrations" ? 1 : 2,
      },
    });
  }
  return `Добавили ${result.addedNew}, в обработке email ${result.enrichQueue.length}`;
}

async function runEnrichJob(
  job: Extract<FsaJob, { type: "enrich" }>
): Promise<string> {
  if (job.category === "new_registrations" && isCheckoBlocked()) {
    // Не помечаем как «успех без continue» молча — очередь ждёт cooldown/cron.
    return getCheckoBlockReason() || "checko на паузе после капчи";
  }

  // checko: 1 сессия (много карточек с паузами внутри) за job, потом continue.
  const isChecko = job.category === "new_registrations";
  const defaultBatches = isChecko ? 1 : 2;
  const maxBatches = Math.min(
    Math.max(job.payload?.maxBatches ?? defaultBatches, 1),
    isChecko ? 3 : 10
  );
  let processed = 0;
  let emails = 0;
  let blocked = false;

  for (let i = 0; i < maxBatches; i++) {
    const queue = readOutreachQueue(job.category);
    if (!queue?.enrichQueue.length || queue.enrichPaused) break;

    const result = await enrichQueueBatch(queue);
    writeOutreachQueue({
      ...applyEnrichResult(queue, result),
      enrichProcessedTotal: (queue.enrichProcessedTotal ?? 0) + result.processed,
      enrichEmailsFoundTotal: (queue.enrichEmailsFoundTotal ?? 0) + result.emailsFound,
    });
    processed += result.processed;
    emails += result.emailsFound;

    if (result.blocked) {
      blocked = true;
      break;
    }
    if (result.enrichPending === 0) break;
    if (result.processed === 0 && result.requeued === 0) break;
    // Раньше при processed===0 (таймаут/профиль) цепочку рвали → «Продолжить».
    // Для checko выходим из цикла job, но ниже всё равно поставим continue, если не blocked.
    if (isChecko && result.processed === 0 && result.requeued > 0) {
      break;
    }
  }

  const latest = readOutreachQueue(job.category);
  const pending = latest?.enrichQueue.length ?? 0;
  const softBlocked = isChecko && isCheckoBlocked();
  // Паузы ≠ стоп. Стоп только капча/ручная пауза/пустая очередь.
  const shouldContinue =
    pending > 0 &&
    !latest?.enrichPaused &&
    !blocked &&
    !softBlocked;
  if (shouldContinue) {
    enqueueFsaJob({
      type: "enrich",
      category: job.category,
      priority: "low",
      source: "enrich_continue",
      payload: { maxBatches: isChecko ? 1 : maxBatches },
    });
  }
  if (blocked || softBlocked) {
    return `Email: пауза из‑за защиты сайта. Обработано ${processed}, найдено ${emails}, осталось ${pending}`;
  }
  return `Email обработка: ${processed}, найдено: ${emails}, осталось: ${pending}`;
}

async function runHealthJob(
  _job: Extract<FsaJob, { type: "health" }>
): Promise<string> {
  const probe = await probeFsaTransport();
  return probe.ok
    ? "Доступ к ФСА есть"
    : `Нет доступа к ФСА: ${probe.error || "проверьте соединение"}`;
}

async function runJob(job: FsaJob): Promise<string> {
  if (job.type === "scan") return runScanJob(job);
  if (job.type === "enrich") return runEnrichJob(job);
  return runHealthJob(job);
}

export function enqueueFsaJob(options: EnqueueOptions): {
  accepted: boolean;
  duplicate: boolean;
  jobId: string;
  pendingAppendScans?: number;
  rejectedReason?: string;
} {
  const state = readState();
  const duplicate = isDuplicatePending(state, options);
  if (duplicate) {
    return {
      accepted: true,
      duplicate: true,
      jobId: duplicate.id,
      pendingAppendScans: countPendingAppendScans(state, options.category),
    };
  }

  if (
    options.category === "new_registrations" &&
    (options.type === "scan" || options.type === "enrich") &&
    isCheckoBlocked()
  ) {
    return {
      accepted: false,
      duplicate: true,
      jobId: "",
      pendingAppendScans: countPendingAppendScans(state, options.category),
      rejectedReason:
        getCheckoBlockReason() ||
        "Сайт недавно отклонил загрузку. Подождите перед повторной попыткой.",
    };
  }

  if (options.type === "scan") {
    const blocked = recentNewRegistrationsBlock(state, options.category);
    if (blocked) {
      return {
        accepted: false,
        duplicate: true,
        jobId: blocked.id,
        pendingAppendScans: countPendingAppendScans(state, options.category),
        rejectedReason:
          blocked.error ||
          "Сайт недавно отклонил загрузку. Подождите перед повторной попыткой.",
      };
    }
  }

  if (
    options.type === "scan" &&
    (options.payload as FsaScanPayload | undefined)?.mode === "append"
  ) {
    const pendingAppends = countPendingAppendScans(state, options.category);
    if (pendingAppends >= MAX_PENDING_APPEND_SCANS) {
      return {
        accepted: false,
        duplicate: true,
        jobId: "",
        pendingAppendScans: pendingAppends,
      };
    }
  }

  const base: FsaJobBase = {
    id: makeId(),
    type: options.type,
    category: options.category,
    priority: options.priority,
    status: "pending",
    createdAt: nowIso(),
    source: options.source,
  };

  const job: FsaJob =
    options.type === "scan"
      ? {
          ...base,
          type: "scan",
          payload: (options.payload as FsaScanPayload) ?? {
            mode: "append",
            maxItems: 100,
            pageSize: 100,
          },
        }
      : options.type === "enrich"
        ? {
            ...base,
            type: "enrich",
            payload: options.payload as { maxBatches?: number } | undefined,
          }
        : { ...base, type: "health" };

  state.jobs = trimHistory([...state.jobs, job]);
  writeState(state);
  return {
    accepted: true,
    duplicate: false,
    jobId: job.id,
    pendingAppendScans: countPendingAppendScans(state, options.category),
  };
}

export async function drainFsaJobs(
  options: { maxMs?: number; category?: OutreachCategory } = {}
): Promise<{ ran: number; ok: number; failed: number }> {
  // Сериализуем drain: двойной kick (scan + after) иначе сбрасывает чужой lock.
  return enqueueDrain(() => drainFsaJobsUnlocked(options));
}

let drainChain: Promise<unknown> = Promise.resolve();

function enqueueDrain<T>(fn: () => Promise<T>): Promise<T> {
  const run = drainChain.then(fn, fn);
  drainChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function drainFsaJobsUnlocked(
  options: { maxMs?: number; category?: OutreachCategory } = {}
): Promise<{ ran: number; ok: number; failed: number }> {
  const maxMs = Math.max(options.maxMs ?? 90_000, 1_000);
  const started = Date.now();
  let ran = 0;
  let ok = 0;
  let failed = 0;

  while (Date.now() - started < maxMs) {
    const before = readState();
    const recovered = recoverStaleLock(before);
    if (recovered !== before) {
      writeState(recovered);
    }

    const state = recoverStaleLock(readState());
    if (state.running) break;

    const next = pickNextJob(
      options.category
        ? state.jobs.filter((job) => job.category === options.category)
        : state.jobs
    );
    if (!next) break;

    const updated = readState();
    const idx = updated.jobs.findIndex((job) => job.id === next.id);
    if (idx === -1) continue;
    updated.running = true;
    updated.jobs[idx] = {
      ...updated.jobs[idx],
      status: "running",
      startedAt: nowIso(),
      error: undefined,
    } as FsaJob;
    writeState(updated);

    const heartbeat = setInterval(() => {
      const live = readState();
      if (!live.running) return;
      // touch updatedAt — иначе долгий scan выглядит как мёртвый lock
      writeState(live);
    }, 20_000);

    try {
      const summary = await runJob(updated.jobs[idx]);
      const complete = readState();
      const completeIdx = complete.jobs.findIndex((job) => job.id === next.id);
      if (completeIdx !== -1) {
        complete.jobs[completeIdx] = {
          ...complete.jobs[completeIdx],
          status: "done",
          finishedAt: nowIso(),
          summary,
        } as FsaJob;
      }
      complete.running = false;
      complete.jobs = trimHistory(complete.jobs);
      writeState(complete);
      ok += 1;
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : "Ошибка задачи";
      if (
        next.category === "new_registrations" &&
        /CHECKO_ACCESS_LIMITED|капч|большое количество|429|не пускает/i.test(
          rawMsg
        )
      ) {
        markCheckoBlocked(rawMsg.slice(0, 120));
      }
      const complete = readState();
      const completeIdx = complete.jobs.findIndex((job) => job.id === next.id);
      if (completeIdx !== -1) {
        complete.jobs[completeIdx] = {
          ...complete.jobs[completeIdx],
          status: "failed",
          finishedAt: nowIso(),
          error: sanitizeJobError(rawMsg),
        } as FsaJob;
      }
      complete.running = false;
      complete.jobs = trimHistory(complete.jobs);
      writeState(complete);
      failed += 1;
    } finally {
      clearInterval(heartbeat);
    }
    ran += 1;
  }

  // Не оставляем pending enrich «висеть» до cron — иначе UI снова «Продолжить».
  if (ran > 0) {
    const leftover = readState().jobs.some(
      (job) =>
        job.status === "pending" &&
        (!options.category || job.category === options.category)
    );
    if (leftover) {
      setTimeout(() => {
        void drainFsaJobs({
          category: options.category,
          maxMs: Math.max(maxMs, 120_000),
        }).catch(() => undefined);
      }, 1500);
    }
  }

  return { ran, ok, failed };
}

function sanitizeJobError(msg: string): string {
  if (/spawn\s+EINVAL|EINVAL/i.test(msg)) {
    return "Не удалось запустить загрузчик. Попробуйте ещё раз — если повторится, перезапустите приложение на сервере.";
  }
  if (
    /TOCHKA_ACCESS_LIMITED|COMPANIUM_ACCESS_LIMITED|CHECKO_ACCESS_LIMITED|подтвердите, что вы человек|капч|большое количество запросов/i.test(
      msg
    )
  ) {
    return "Сайт сейчас не пускает автоматическую загрузку (защита от ботов). Записи в очередь не попали. Подождите и попробуйте снова.";
  }
  if (
    /OUTREACH_|playwright|checko-pw-profile|npx playwright|Executable doesn't exist/i.test(
      msg
    )
  ) {
    return "Не удалось загрузить данные с сайта. Записи в очередь не попали.";
  }
  if (/HTTP 429|HTTP 503|перегружен/i.test(msg)) {
    return "Сайт временно перегружен (слишком много запросов). Записи в очередь не попали. Подождите несколько минут.";
  }
  if (/Timeout|timeout|не ответил/i.test(msg)) {
    return "Сайт не ответил вовремя. Записи в очередь не попали.";
  }
  return msg.length > 280 ? `${msg.slice(0, 277)}…` : msg;
}

/** После капчи/429 повторные клики только жгут лимит — держим паузу. */
const NEW_REG_COOLDOWN_MS = 25 * 60_000;

function recentNewRegistrationsBlock(
  state: FsaOrchestratorState,
  category: OutreachCategory
): FsaJob | null {
  if (category !== "new_registrations") return null;
  const cutoff = Date.now() - NEW_REG_COOLDOWN_MS;
  const blocked = state.jobs
    .filter(
      (job) =>
        job.category === category &&
        (job.type === "scan" || job.type === "enrich") &&
        job.status === "failed" &&
        job.finishedAt &&
        Date.parse(job.finishedAt) >= cutoff &&
        /CHECKO_ACCESS|не пускает|капч|перегружен|429|защит/i.test(
          job.error || ""
        )
    )
    .sort(
      (a, b) =>
        Date.parse(b.finishedAt || "") - Date.parse(a.finishedAt || "")
    )[0];
  return blocked ?? null;
}

/** Запуск drain после ответа админке — не ждать ближайший cron (до 20 мин). */
export function kickFsaDrain(
  category?: OutreachCategory,
  maxMs = 180_000
): void {
  // Сразу + страховка: на части окружений after() может не дойти.
  void drainFsaJobs({ category, maxMs }).catch((error) => {
    console.error(
      "kickFsaDrain failed:",
      error instanceof Error ? error.message : error
    );
  });
}

export function cancelPendingFsaJobs(
  category: OutreachCategory,
  types?: Array<"scan" | "enrich" | "health">
): number {
  const allow = new Set(types ?? ["scan", "enrich", "health"]);
  const state = readState();
  let cancelled = 0;
  let clearedRunning = false;
  const jobs = state.jobs.map((job) => {
    if (
      job.category === category &&
      (job.status === "pending" || job.status === "running") &&
      allow.has(job.type)
    ) {
      cancelled += 1;
      if (job.status === "running") clearedRunning = true;
      return {
        ...job,
        status: "failed" as const,
        finishedAt: nowIso(),
        startedAt: undefined,
        error: "Снято с очереди вручную",
      };
    }
    return job;
  });
  if (cancelled > 0 || clearedRunning) {
    const nextJobs = trimHistory(jobs);
    writeState({
      ...state,
      // Lock снимаем только если убрали running-задачу (или их больше нет).
      running: nextJobs.some((job) => job.status === "running"),
      jobs: nextJobs,
    });
  }
  return cancelled;
}

/** @deprecated use cancelPendingFsaJobs(category, ["enrich"]) */
export function cancelPendingEnrichJobs(category: OutreachCategory): number {
  return cancelPendingFsaJobs(category, ["enrich"]);
}

export function getFsaQueueStatus(category?: OutreachCategory): {
  pendingHigh: number;
  pendingLow: number;
  running: boolean;
  runningType: FsaJobType | null;
  runningSince: string | null;
  enrichQueued: boolean;
  enrichRunning: boolean;
  scanQueued: boolean;
  pendingScanAppend: number;
  lastSummary: string | null;
  lastError: string | null;
} {
  const state = readStateRecovered();
  const jobs = category
    ? state.jobs.filter((job) => job.category === category)
    : state.jobs;
  const pendingHigh = jobs.filter(
    (job) => job.status === "pending" && job.priority === "high"
  ).length;
  const pendingLow = jobs.filter(
    (job) => job.status === "pending" && job.priority === "low"
  ).length;
  const enrichQueued = jobs.some(
    (job) => job.type === "enrich" && job.status === "pending"
  );
  const enrichRunning = jobs.some(
    (job) => job.type === "enrich" && job.status === "running"
  );
  const scanQueued = jobs.some(
    (job) => job.type === "scan" && job.status === "pending"
  );
  const pendingScanAppend = jobs.filter(
    (job) =>
      job.status === "pending" &&
      job.type === "scan" &&
      job.payload.mode === "append"
  ).length;
  const runningJob = jobs
    .filter((job) => job.status === "running")
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""))[0];
  const completed = [...jobs]
    .filter((job) => job.status === "done" || job.status === "failed")
    .sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""));
  // Ручная отмена — не «ошибка» для UI, иначе висит поверх актуального статуса.
  const latestMeaningful = completed.find((job) => {
    const err = (job.error || "").trim();
    if (!err) return Boolean(job.summary);
    return !/снято с очереди|остановлено вручную/i.test(err);
  });
  const hasActive =
    Boolean(runningJob) || pendingHigh > 0 || pendingLow > 0 || scanQueued;
  return {
    pendingHigh,
    pendingLow,
    // Для UI категории: «идёт» = есть running-задача ЭТОЙ категории
    // (глобальный lock один на все категории и врёт при гонках drain).
    running: Boolean(runningJob) || (category ? false : state.running),
    runningType: runningJob?.type ?? null,
    runningSince: runningJob?.startedAt ?? null,
    enrichQueued,
    enrichRunning,
    scanQueued,
    pendingScanAppend,
    lastSummary: hasActive ? null : (latestMeaningful?.summary ?? null),
    // Пока есть активные задачи — не показываем прошлый fail.
    lastError: hasActive ? null : (latestMeaningful?.error ?? null),
  };
}

