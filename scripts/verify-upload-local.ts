/**
 * Local upload API smoke test.
 * Run: npx tsx scripts/verify-upload-local.ts
 */
import { config } from "dotenv";
import fs from "fs";
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
  if (!res.ok) return null;
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") || ""];
  const match = setCookies.join("; ").match(/navicert_admin=([^;]+)/);
  return match ? `navicert_admin=${match[1]}` : null;
}

async function upload(
  cookie: string,
  folder: "uploads" | "articles",
  bytes: Buffer,
  name: string
) {
  const blob = new Blob([bytes], { type: "image/png" });
  const form = new FormData();
  form.append("file", blob, `${name}.png`);
  form.append("name", name);
  form.append("folder", folder);

  const res = await fetch(`${base}/api/admin/upload`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log("Upload verify\n");
  const cookie = await login();
  if (!cookie) {
    console.error("login failed");
    process.exit(1);
  }

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

  for (const folder of ["articles", "uploads"] as const) {
    const up = await upload(cookie, folder, png, `verify-${folder}`);
    if (up.status >= 400 || !up.json.url) {
      console.error(`${folder} upload failed`, up);
      process.exit(1);
    }
    const get = await fetch(`${base}${up.json.url}`);
    console.log(`${folder}: upload ${up.status}, serve ${get.status} ${up.json.url}`);
    if (!get.ok) process.exit(1);
  }

  console.log("\n--- upload OK ---\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
