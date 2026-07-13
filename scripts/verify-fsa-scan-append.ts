/**
 * FSA scan append: не сбрасывает очередь, принимает maxItems до 1000.
 * Run: npx tsx scripts/verify-fsa-scan-append.ts
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

const base = process.env.VERIFY_BASE_URL || "http://localhost:3000";
const password = process.env.ADMIN_PASSWORD || "navicert2025";

async function login() {
  const res = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    console.error("login status:", res.status, await res.text());
    return null;
  }
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") || ""];
  const match = setCookies.join("; ").match(/navicert_admin=([^;]+)/);
  return match ? `navicert_admin=${match[1]}` : null;
}

async function scan(
  cookie: string,
  mode: "reset" | "append",
  maxItems: number
) {
  const res = await fetch(`${base}/api/admin/outreach/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ mode, maxItems, pageSize: 100 }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { error: text.slice(0, 300) } };
  }
}

async function main() {
  console.log("FSA scan append verify\n");
  const cookie = await login();
  if (!cookie) {
    console.error("admin login failed");
    process.exit(1);
  }

  console.log("1) Initial load (reset, maxItems=20)...");
  const first = await scan(cookie, "reset", 20);
  if (!first.status || first.status >= 400) {
    console.error("reset failed:", first.body);
    process.exit(1);
  }
  const idsAfterFirst = Number(first.body.eligible ?? 0) + Number(first.body.rejected ?? 0);
  console.log(`   loaded=${first.body.loadedFromApi} added=${first.body.addedNew} queue~${idsAfterFirst}`);

  console.log("2) Append load (append, maxItems=30)...");
  const second = await scan(cookie, "append", 30);
  if (!second.status || second.status >= 400) {
    console.error("append failed:", second.body);
    process.exit(1);
  }
  const idsAfterSecond = Number(second.body.eligible ?? 0) + Number(second.body.rejected ?? 0);
  console.log(`   mode=${second.body.mode} loaded=${second.body.loadedFromApi} added=${second.body.addedNew}`);

  if (idsAfterSecond < idsAfterFirst) {
    console.error(`QUEUE SHRANK: ${idsAfterFirst} -> ${idsAfterSecond}`);
    process.exit(1);
  }
  console.log(`   queue preserved/grew: ${idsAfterFirst} -> ${idsAfterSecond}`);
  console.log("\n--- FSA append OK ---\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
