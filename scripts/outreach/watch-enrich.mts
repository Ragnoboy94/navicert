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
  const start = await fetch(
    `${BASE}/api/admin/outreach/enrich?category=expiring_certificates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: c },
      body: JSON.stringify({ force: true }),
    }
  ).then((r) => r.json());
  console.log("start", start);

  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 5_000));
    const st = await fetch(
      `${BASE}/api/admin/outreach/enrich?category=expiring_certificates`,
      { headers: { Cookie: c } }
    ).then((r) => r.json());
    console.log(`t+${(i + 1) * 5}s`, {
      running: st.running,
      pending: st.pending,
      processed: st.processedTotal,
      emails: st.emailsFoundTotal,
      lastBatchAt: st.lastBatchAt,
      lastError: st.lastError,
    });
    if (!st.running) break;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
