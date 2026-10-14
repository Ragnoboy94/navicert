import { CHAT_AGENT_AWAY_MS } from "./types";

type PresenceState = {
  lastSeenAt: number;
  online: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const globalKey = "__navicert_agent_presence__";
const broadcastKey = "__navicert_broadcast_visitors__";

type BroadcastFn = (payload: unknown) => void;

function state(): PresenceState {
  const g = globalThis as Record<string, unknown>;
  const existing = g[globalKey] as Partial<PresenceState> | undefined;
  if (!existing || typeof existing.lastSeenAt !== "number") {
    if (existing && "timer" in existing && existing.timer) {
      clearTimeout(existing.timer as ReturnType<typeof setTimeout>);
    }
    g[globalKey] = {
      lastSeenAt: 0,
      online: false,
      timer: null,
    } satisfies PresenceState;
  }
  return g[globalKey] as PresenceState;
}

function broadcastPresence(online: boolean) {
  const fn = (globalThis as Record<string, unknown>)[broadcastKey] as
    | BroadcastFn
    | undefined;
  if (typeof fn === "function") {
    fn({ type: "agent_presence", online });
  }
}

function scheduleAwayCheck() {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  const left = CHAT_AGENT_AWAY_MS - (Date.now() - s.lastSeenAt);
  s.timer = setTimeout(() => {
    if (Date.now() - s.lastSeenAt >= CHAT_AGENT_AWAY_MS) {
      setOnline(false);
    } else {
      scheduleAwayCheck();
    }
  }, Math.max(500, left + 20));
}

function setOnline(next: boolean) {
  const s = state();
  if (s.online === next) return;
  s.online = next;
  broadcastPresence(next);
}

/** Вызывается из WS при старте — чтобы presence слал события в уже поднятый сокет. */
export function registerVisitorBroadcaster(fn: BroadcastFn) {
  (globalThis as Record<string, unknown>)[broadcastKey] = fn;
}

/** Админ в разделе чата / прочитал / ответил / heartbeat. */
export function touchAgentPresence(): boolean {
  const s = state();
  s.lastSeenAt = Date.now();
  const was = s.online;
  s.online = true;
  scheduleAwayCheck();
  // Всегда пушим в виджет — иначе посетитель может «залипнуть» в offline,
  // если пропустил первый agent_presence.
  broadcastPresence(true);
  return !was;
}

export function isAgentOnline(): boolean {
  const s = state();
  if (!s.online) return false;
  if (Date.now() - s.lastSeenAt >= CHAT_AGENT_AWAY_MS) {
    setOnline(false);
    return false;
  }
  return true;
}
