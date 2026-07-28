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
  const list = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  return list.map((c) => c.split(";")[0]).join("; ") ||
    (login.headers.get("set-cookie") || "").split(";")[0];
}

async function scan(cookie: string, category: string, mode: "reset" | "append") {
  const started = Date.now();
  const res = await fetch(
    `${BASE}/api/admin/outreach/scan?category=${encodeURIComponent(category)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode, maxItems: 10, pageSize: 10, category }),
    }
  );
  const body = await res.json();
  return { http: res.status, ms: Date.now() - started, body };
}

async function main() {
  const c = await cookie();
  console.log("cookie", Boolean(c));

  const decls = await scan(c, "expiring", "append");
  console.log("declarations", JSON.stringify({ http: decls.http, ms: decls.ms, body: decls.body }, null, 2));

  const certs = await scan(c, "expiring_certificates", "reset");
  console.log("certificates", JSON.stringify({ http: certs.http, ms: certs.ms, body: certs.body }, null, 2));

  if (decls.http !== 200 || certs.http !== 200) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
