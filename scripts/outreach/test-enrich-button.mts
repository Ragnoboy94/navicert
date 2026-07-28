import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env.local") });

const BASE = "http://localhost:3000";
const pw = process.env.ADMIN_PASSWORD!;

async function cookie() {
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  const h = login.headers as Headers & { getSetCookie?: () => string[] };
  return (typeof h.getSetCookie === "function" ? h.getSetCookie() : [])
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function main() {
  const c = await cookie();

  // Догрузить немного сертификатов, чтобы была очередь enrich
  const scan = await fetch(
    `${BASE}/api/admin/outreach/scan?category=expiring_certificates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c },
      body: JSON.stringify({
        mode: "append",
        maxItems: 20,
        pageSize: 20,
        category: "expiring_certificates",
      }),
    }
  ).then(async (r) => ({ http: r.status, body: await r.json() }));
  console.log("scan", {
    http: scan.http,
    ok: scan.body.ok,
    error: scan.body.error,
    loaded: scan.body.loadedFromApi,
    enrichPending: scan.body.enrichPending,
  });

  // На всякий случай stop, потом start как кнопка
  await fetch(
    `${BASE}/api/admin/outreach/enrich?category=expiring_certificates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c },
      body: JSON.stringify({ action: "stop" }),
    }
  );

  await new Promise((r) => setTimeout(r, 500));

  const start = await fetch(
    `${BASE}/api/admin/outreach/enrich?category=expiring_certificates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c },
      body: JSON.stringify({ force: true }),
    }
  ).then(async (r) => ({ http: r.status, body: await r.json() }));

  console.log("start", {
    http: start.http,
    started: start.body.started,
    alreadyRunning: start.body.alreadyRunning,
    running: start.body.running,
    paused: start.body.paused,
    pending: start.body.pending,
    message: start.body.message,
    lastError: start.body.lastError,
  });

  await new Promise((r) => setTimeout(r, 2000));
  const st = await fetch(
    `${BASE}/api/admin/outreach?category=expiring_certificates`,
    { headers: { Cookie: c } }
  ).then((r) => r.json());
  console.log("after2s", {
    enrichPending: st.enrichPending,
    running: st.enrichStatus?.running,
    paused: st.enrichStatus?.paused,
    processed: st.enrichStatus?.processedTotal,
    lastError: st.enrichStatus?.lastError,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
