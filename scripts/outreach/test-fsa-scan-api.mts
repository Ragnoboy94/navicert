/**
 * Тот же backend, что кнопки в админке: login cookie → POST /scan для обеих категорий.
 * Без отправки писем.
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

const BASE_URL = process.env.VERIFY_BASE_URL?.trim() || "http://localhost:3000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim();
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD missing");
  process.exit(1);
}

function collectCookies(res: Response): string {
  // Node 22 fetch: getSetCookie if available
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : [];
  if (list.length) {
    return list.map((c) => c.split(";")[0]).join("; ");
  }
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function scan(cookie: string, category: string) {
  const started = Date.now();
  const res = await fetch(
    `${BASE_URL}/api/admin/outreach/scan?category=${encodeURIComponent(category)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        mode: "append",
        maxItems: 100,
        pageSize: 100,
        category,
      }),
    }
  );
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  // Если очереди нет — как кнопка «Догрузить» на пустой вкладке: reset 100
  if (!res.ok && /Сначала выполните полную загрузку/i.test(String(body.error ?? ""))) {
    const resetRes = await fetch(
      `${BASE_URL}/api/admin/outreach/scan?category=${encodeURIComponent(category)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({
          mode: "reset",
          maxItems: 100,
          pageSize: 100,
          category,
        }),
      }
    );
    const resetBody = (await resetRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return {
      category,
      mode: "reset",
      http: resetRes.status,
      ok: resetRes.ok,
      ms: Date.now() - started,
      error: resetBody.error ?? null,
      loadedFromApi: resetBody.loadedFromApi ?? null,
      addedNew: resetBody.addedNew ?? null,
      eligible: resetBody.eligible ?? null,
      enrichPending: resetBody.enrichPending ?? null,
      hasMore: resetBody.hasMore ?? null,
      range: resetBody.range ?? null,
    };
  }

  return {
    category,
    mode: "append",
    http: res.status,
    ok: res.ok,
    ms: Date.now() - started,
    error: body.error ?? null,
    loadedFromApi: body.loadedFromApi ?? null,
    addedNew: body.addedNew ?? null,
    eligible: body.eligible ?? null,
    enrichPending: body.enrichPending ?? null,
    hasMore: body.hasMore ?? null,
    range: body.range ?? null,
  };
}

async function main() {
  console.log("API scan via admin session:", BASE_URL);

  const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error("login failed", loginRes.status);
    process.exit(1);
  }
  const cookie = collectCookies(loginRes);
  if (!cookie) {
    console.error("no session cookie from login");
    process.exit(1);
  }
  console.log("login ok");

  const declarations = await scan(cookie, "expiring");
  console.log("declarations", JSON.stringify(declarations, null, 2));

  const certificates = await scan(cookie, "expiring_certificates");
  console.log("certificates", JSON.stringify(certificates, null, 2));

  if (!declarations.ok || !certificates.ok) {
    process.exitCode = 1;
    console.error("FAILED");
    return;
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        declarationsLoaded: declarations.loadedFromApi,
        certificatesLoaded: certificates.loadedFromApi,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
