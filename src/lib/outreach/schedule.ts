import fs from "fs";
import path from "path";
import { clampDailyCount, MAX_BATCH_SEND } from "./limits";
import { readSentRecordsByCategory, sendOutreachBatch } from "./mailer";
import { readOutreachQueue } from "./queue";
import { pickSendableCandidates } from "./send-selection";
import type { OutreachCategory, OutreachSchedule, OutreachScheduleRun } from "./types";

function schedulePath(category: OutreachCategory): string {
  const file =
    category === "expiring_certificates"
      ? "outreach-certificates-schedule.json"
      : "outreach-schedule.json";
  return path.join(process.cwd(), "data", file);
}
const TIMEZONE = "Europe/Moscow";
const SLOT_WINDOW_MINUTES = 60;
const NOON_MINUTES = 12 * 60;
const WORKDAY_FROM_MINUTES = 9 * 60;
const WORKDAY_TO_MINUTES = 15 * 60;

const defaultSchedule = (): OutreachSchedule => ({
  enabled: false,
  emailsPerDay: 50,
  timezone: TIMEZONE,
  todayPlan: null,
  completedSlotsToday: [],
  lastRunAt: null,
  lastRunSent: 0,
  lastFsaSyncDate: null,
  lastFsaSyncAt: null,
  lastHourlyFsaAppendAt: null,
});

export function readOutreachSchedule(
  category: OutreachCategory = "expiring"
): OutreachSchedule {
  const spath = schedulePath(category);
  if (!fs.existsSync(spath)) return ensureTodayPlan(defaultSchedule(), category);
  const parsed = JSON.parse(
    fs.readFileSync(spath, "utf-8")
  ) as Partial<OutreachSchedule> & {
    runsPerDay?: number;
    startTime?: string;
  };
  return ensureTodayPlan(normalizeSchedule(parsed), category);
}

export function writeOutreachSchedule(
  patch: Partial<OutreachSchedule> & { category?: OutreachCategory }
): OutreachSchedule {
  const category = patch.category ?? "expiring";
  const current = readOutreachSchedule(category);
  const emailsChanged =
    patch.emailsPerDay !== undefined &&
    patch.emailsPerDay !== current.emailsPerDay;
  const next = normalizeSchedule({ ...current, ...patch });
  const planned = emailsChanged
    ? regenerateTodayPlan(next)
    : ensureTodayPlan(next, category);
  persistSchedule(planned, category);
  return planned;
}

function persistSchedule(
  schedule: OutreachSchedule,
  category: OutreachCategory
): void {
  const dir = path.dirname(schedulePath(category));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    schedulePath(category),
    JSON.stringify(schedule, null, 2) + "\n"
  );
}

function normalizeSchedule(
  schedule: Partial<OutreachSchedule>
): OutreachSchedule {
  const base = defaultSchedule();
  const dateKey = getDateKey(new Date());
  const storedDateKey = schedule.completedSlotsToday?.[0]?.split("|")[0];

  return {
    enabled: Boolean(schedule.enabled),
    emailsPerDay: clampDailyCount(schedule.emailsPerDay ?? base.emailsPerDay),
    timezone: TIMEZONE,
    todayPlan: schedule.todayPlan ?? null,
    completedSlotsToday:
      storedDateKey === dateKey ? (schedule.completedSlotsToday ?? []) : [],
    lastRunAt: schedule.lastRunAt ?? null,
    lastRunSent: Number(schedule.lastRunSent) || 0,
    lastFsaSyncDate: schedule.lastFsaSyncDate ?? null,
    lastFsaSyncAt: schedule.lastFsaSyncAt ?? null,
    lastHourlyFsaAppendAt: schedule.lastHourlyFsaAppendAt ?? null,
  };
}

function getRunsCount(emailsPerDay: number): number {
  return Math.min(5, Math.max(1, Math.ceil(emailsPerDay / 40)));
}

function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function generateTodayTimes(emailsPerDay: number): string[] {
  const count = getRunsCount(emailsPerDay);
  const times = new Set<string>();

  for (let attempt = 0; attempt < 200 && times.size < count; attempt++) {
    const offset = Math.floor(Math.random() * 361) - 180;
    const minutes = Math.min(
      WORKDAY_TO_MINUTES,
      Math.max(WORKDAY_FROM_MINUTES, NOON_MINUTES + offset)
    );
    times.add(formatTime(minutes));
  }

  return [...times].sort();
}

function regenerateTodayPlan(schedule: OutreachSchedule): OutreachSchedule {
  const dateKey = getDateKey(new Date());
  return {
    ...schedule,
    todayPlan: { date: dateKey, times: generateTodayTimes(schedule.emailsPerDay) },
    completedSlotsToday: [],
  };
}

function ensureTodayPlan(
  schedule: OutreachSchedule,
  category: OutreachCategory
): OutreachSchedule {
  const dateKey = getDateKey(new Date());
  if (schedule.todayPlan?.date === dateKey) return schedule;

  const next = regenerateTodayPlan(schedule);
  if (fs.existsSync(schedulePath(category))) persistSchedule(next, category);
  return next;
}

export function getDateKey(date: Date, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

export function getZonedParts(date: Date, timeZone = TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0
  );
  return { hour, minute, minutes: hour * 60 + minute };
}

export function countSentToday(
  timeZone = TIMEZONE,
  category: OutreachCategory = "expiring"
): number {
  const today = getDateKey(new Date(), timeZone);
  return readSentRecordsByCategory(category).filter(
    (record) => getDateKey(new Date(record.sentAt), timeZone) === today
  ).length;
}

function getRunSlots(schedule: OutreachSchedule) {
  const times = schedule.todayPlan?.times ?? [];
  return times.map((time) => {
    const [hour, minute] = time.split(":").map(Number);
    return {
      key: time,
      hour,
      minute,
      minutes: hour * 60 + minute,
    };
  });
}

function getActiveSlot(schedule: OutreachSchedule, now = new Date()) {
  const { minutes: nowMinutes } = getZonedParts(now, schedule.timezone);
  const dateKey = getDateKey(now, schedule.timezone);
  const slots = getRunSlots(schedule);

  for (const slot of slots) {
    const slotKey = `${dateKey}|${slot.key}`;
    if (schedule.completedSlotsToday.includes(slotKey)) continue;
    const delta = nowMinutes - slot.minutes;
    if (delta >= 0 && delta < SLOT_WINDOW_MINUTES) {
      return { slotKey, slot };
    }
  }

  return null;
}

export function getNextRunLabel(schedule: OutreachSchedule, now = new Date()) {
  if (!schedule.enabled) return "Автоотправка выключена";

  const dateKey = getDateKey(now, schedule.timezone);
  const { minutes: nowMinutes } = getZonedParts(now, schedule.timezone);
  const slots = getRunSlots(schedule);

  for (const slot of slots) {
    const slotKey = `${dateKey}|${slot.key}`;
    if (schedule.completedSlotsToday.includes(slotKey)) continue;
    if (slot.minutes >= nowMinutes) {
      return `Сегодня в ${slot.key} (МСК)`;
    }
  }

  return "Сегодня запуски завершены";
}

export function getScheduleStats(
  arg: OutreachSchedule | OutreachCategory = "expiring",
  categoryWhenSchedule?: OutreachCategory
) {
  const category =
    typeof arg === "string"
      ? (arg as OutreachCategory)
      : (categoryWhenSchedule ?? "expiring");
  const schedule =
    typeof arg === "string" ? readOutreachSchedule(category) : arg;

  const planned = ensureTodayPlan(schedule, category);
  const sentToday = countSentToday(planned.timezone, category);
  const remainingToday = Math.max(planned.emailsPerDay - sentToday, 0);
  const runsToday = planned.todayPlan?.times.length ?? getRunsCount(planned.emailsPerDay);
  const perRunLimit = Math.max(
    1,
    Math.min(Math.ceil(planned.emailsPerDay / runsToday), MAX_BATCH_SEND)
  );

  return {
    schedule: planned,
    sentToday,
    remainingToday,
    perRunLimit,
    runsToday,
    workHoursLabel: "9:00–15:00 МСК",
    nextRunLabel: getNextRunLabel(planned),
  };
}

export type ScheduledSendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  sent: number;
  attempted: number;
  remainingToday: number;
  slotKey?: string;
  run?: OutreachScheduleRun;
  emailValidation?: import("./queue-email-validation").QueueEmailValidationResult | null;
};

export async function runScheduledOutreach(options: {
  force?: boolean;
  category?: OutreachCategory;
} = {}): Promise<ScheduledSendResult> {
  const category = options.category ?? "expiring";
  const schedule = readOutreachSchedule(category);
  const stats = getScheduleStats(category);

  if (!schedule.enabled && !options.force) {
    return {
      ok: true,
      skipped: true,
      reason: "disabled",
      sent: 0,
      attempted: 0,
      remainingToday: stats.remainingToday,
    };
  }

  if (stats.remainingToday <= 0) {
    return {
      ok: true,
      skipped: true,
      reason: "daily_limit_reached",
      sent: 0,
      attempted: 0,
      remainingToday: 0,
    };
  }

  const activeSlot = options.force ? null : getActiveSlot(schedule);
  if (!options.force && !activeSlot) {
    return {
      ok: true,
      skipped: true,
      reason: "not_scheduled_now",
      sent: 0,
      attempted: 0,
      remainingToday: stats.remainingToday,
    };
  }

  const queue = readOutreachQueue(category);
  if (!queue?.items?.length) {
    return {
      ok: false,
      skipped: true,
      reason: "empty_queue",
      sent: 0,
      attempted: 0,
      remainingToday: stats.remainingToday,
    };
  }

  const candidates = pickSendableCandidates(queue.items, {
    forAutoSend: true,
    limit: Math.min(stats.perRunLimit, stats.remainingToday, MAX_BATCH_SEND),
    category,
  });
  const batchSize = candidates.length;

  if (batchSize <= 0) {
    return {
      ok: true,
      skipped: true,
      reason: "no_candidates",
      sent: 0,
      attempted: 0,
      remainingToday: stats.remainingToday,
    };
  }

  const { results, emailValidation } = await sendOutreachBatch(candidates, {
    category,
  });
  const sent = results.filter((item) => item.ok).length;
  const runAt = new Date().toISOString();
  const slotKey =
    activeSlot?.slotKey ??
    `${getDateKey(new Date(), schedule.timezone)}|manual`;

  writeOutreachSchedule({
    category,
    completedSlotsToday: activeSlot
      ? [...schedule.completedSlotsToday, activeSlot.slotKey]
      : schedule.completedSlotsToday,
    lastRunAt: runAt,
    lastRunSent: sent,
  });

  return {
    ok: true,
    sent,
    attempted: batchSize,
    remainingToday: Math.max(stats.remainingToday - sent, 0),
    slotKey,
    run: { at: runAt, sent, attempted: batchSize, slotKey },
    emailValidation,
  };
}

export function verifyCronSecret(request: Request): boolean {
  const expected = process.env.OUTREACH_CRON_SECRET?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization")?.trim();
  if (header === `Bearer ${expected}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === expected;
}
