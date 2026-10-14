import fs from "fs";
import path from "path";
import webpush from "web-push";

const VAPID_PATH = path.join(process.cwd(), "data", "vapid-keys.json");
const SUBS_PATH = path.join(process.cwd(), "data", "push-subscriptions.json");

type VapidKeys = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type PushSubscriptionJSON = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type SubsFile = {
  subscriptions: PushSubscriptionJSON[];
};

function ensureDataDir() {
  const dir = path.dirname(VAPID_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadOrCreateVapid(): VapidKeys {
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    `mailto:${process.env.NOTIFY_EMAIL?.trim() || "info@navicert.pro"}`;

  if (
    process.env.VAPID_PUBLIC_KEY?.trim() &&
    process.env.VAPID_PRIVATE_KEY?.trim()
  ) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim(),
      subject,
    };
  }

  try {
    if (fs.existsSync(VAPID_PATH)) {
      const raw = JSON.parse(fs.readFileSync(VAPID_PATH, "utf-8")) as VapidKeys;
      if (raw.publicKey && raw.privateKey) {
        return { ...raw, subject: raw.subject || subject };
      }
    }
  } catch {
    /* regenerate */
  }

  const generated = webpush.generateVAPIDKeys();
  const keys: VapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };
  ensureDataDir();
  fs.writeFileSync(VAPID_PATH, JSON.stringify(keys, null, 2), "utf-8");
  return keys;
}

let configured = false;

function ensureWebPush() {
  if (configured) return;
  const keys = loadOrCreateVapid();
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  configured = true;
}

export function getVapidPublicKey(): string {
  return loadOrCreateVapid().publicKey;
}

function readSubs(): SubsFile {
  try {
    if (!fs.existsSync(SUBS_PATH)) return { subscriptions: [] };
    const raw = JSON.parse(fs.readFileSync(SUBS_PATH, "utf-8")) as SubsFile;
    if (!Array.isArray(raw.subscriptions)) return { subscriptions: [] };
    return raw;
  } catch {
    return { subscriptions: [] };
  }
}

function writeSubs(file: SubsFile) {
  ensureDataDir();
  const tmp = `${SUBS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf-8");
  fs.renameSync(tmp, SUBS_PATH);
}

export function savePushSubscription(sub: PushSubscriptionJSON): void {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error("invalid_subscription");
  }
  const file = readSubs();
  file.subscriptions = [
    sub,
    ...file.subscriptions.filter((s) => s.endpoint !== sub.endpoint),
  ].slice(0, 50);
  writeSubs(file);
}

export function removePushSubscription(endpoint: string): void {
  const file = readSubs();
  file.subscriptions = file.subscriptions.filter(
    (s) => s.endpoint !== endpoint
  );
  writeSubs(file);
}

export async function notifyAdminsChatPush(payload: {
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  ensureWebPush();
  const file = readSubs();
  if (file.subscriptions.length === 0) return;

  const data = JSON.stringify({
    title: payload.title,
    body: payload.body.slice(0, 180),
    url: payload.url || "/admin",
  });

  const alive: PushSubscriptionJSON[] = [];
  await Promise.all(
    file.subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, data, {
          TTL: 60 * 60,
          urgency: "high",
        });
        alive.push(sub);
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        // 404/410 — подписка протухла
        if (status === 404 || status === 410) return;
        alive.push(sub);
        console.warn("[push] send failed", status || err);
      }
    })
  );

  if (alive.length !== file.subscriptions.length) {
    writeSubs({ subscriptions: alive });
  }
}
