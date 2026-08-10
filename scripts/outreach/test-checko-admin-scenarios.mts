/**
 * Сценарные ожидания для вкладки «Новые организации» (checko).
 * Не ломает ФСА: только category=new_registrations.
 *
 * Запуск: npx tsx scripts/outreach/test-checko-admin-scenarios.mts
 *
 * Сценарии:
 * 1) Пустая вкладка lite GET < 2.5s, без technical env в теле
 * 2) POST scan → в ответе есть прогресс (pendingHigh|running|scanQueued)
 * 3) Пока задача жива — lite статус показывает running или pending
 * 4) Ошибки в lastError без OUTREACH_/Playwright/путей
 * 5) GET expiring (ФСА) по-прежнему отвечает 200 (изоляция)
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

const BASE = process.env.VERIFY_BASE_URL?.trim() || "http://localhost:3000";
const PASSWORD =
  process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_PASS?.trim() || "navicert2025";

type Step = { name: string; ok: boolean; detail?: string };

const steps: Step[] = [];

function expect(name: string, cond: boolean, detail?: string) {
  steps.push({ name, ok: cond, detail });
  const mark = cond ? "OK" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function collectCookies(res: Response): string {
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

function hasTechLeak(text: string): boolean {
  return /OUTREACH_|PLAYWRIGHT|checko-pw-profile|npx playwright|Executable doesn't exist|cursor-sandbox/i.test(
    text
  );
}

async function main() {
  console.log(`BASE=${BASE}`);

  const loginRes = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  expect("login 200", loginRes.status === 200, `status=${loginRes.status}`);
  const cookie = collectCookies(loginRes);
  expect("login cookie", Boolean(cookie));

  const t0 = Date.now();
  const liteRes = await fetch(
    `${BASE}/api/admin/outreach?category=new_registrations&lite=1`,
    { headers: { Cookie: cookie } }
  );
  const liteMs = Date.now() - t0;
  const lite = (await liteRes.json().catch(() => ({}))) as Record<string, unknown>;
  expect("S1 lite status 200", liteRes.status === 200);
  expect(
    "S1 lite < 2500ms (пустая вкладка не должна висеть)",
    liteMs < 2500,
    `${liteMs}ms`
  );
  expect("S1 есть fsaQueue", Boolean(lite.fsaQueue));
  expect(
    "S1 нет технарского мусора в JSON",
    !hasTechLeak(JSON.stringify(lite))
  );

  const fsaLite = await fetch(
    `${BASE}/api/admin/outreach?category=expiring&lite=1`,
    { headers: { Cookie: cookie } }
  );
  expect(
    "S5 ФСА lite жив (не сломали старое)",
    fsaLite.status === 200,
    `status=${fsaLite.status}`
  );

  const scanRes = await fetch(
    `${BASE}/api/admin/outreach/scan?category=new_registrations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        category: "new_registrations",
        mode: "reset",
        maxItems: 10,
        pageSize: 10,
      }),
    }
  );
  const scan = (await scanRes.json().catch(() => ({}))) as {
    ok?: boolean;
    queued?: boolean;
    fsaQueue?: {
      pendingHigh?: number;
      pendingLow?: number;
      running?: boolean;
      scanQueued?: boolean;
      runningType?: string | null;
      lastError?: string | null;
    };
    message?: string;
    error?: string;
  };
  expect(
    "S2 scan принят (200/409)",
    scanRes.status === 200 || scanRes.status === 409,
    `status=${scanRes.status}`
  );
  const fq = scan.fsaQueue;
  const progressVisible =
    Boolean(fq?.running) ||
    Boolean(fq?.scanQueued) ||
    (fq?.pendingHigh ?? 0) > 0;
  const rejectedWithReason =
    scanRes.status === 409 &&
    Boolean(scan.error) &&
    !hasTechLeak(String(scan.error || ""));
  expect(
    "S2 после клика: прогресс ИЛИ честный отказ (капча/кулдаун)",
    progressVisible || rejectedWithReason,
    JSON.stringify({ fq, error: scan.error, status: scanRes.status })
  );
  expect(
    "S2 сообщение без технарщины",
    !hasTechLeak(`${scan.message || ""} ${scan.error || ""}`)
  );

  let sawBusy = progressVisible;
  let lastErr: string | null = scan.error || fq?.lastError || null;
  if (!rejectedWithReason) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const stRes = await fetch(
        `${BASE}/api/admin/outreach?category=new_registrations&lite=1`,
        { headers: { Cookie: cookie } }
      );
      const st = (await stRes.json()) as {
        fsaQueue?: {
          running?: boolean;
          scanQueued?: boolean;
          pendingHigh?: number;
          lastError?: string | null;
          lastSummary?: string | null;
        };
        itemsCount?: number;
      };
      const busy =
        Boolean(st.fsaQueue?.running) ||
        Boolean(st.fsaQueue?.scanQueued) ||
        (st.fsaQueue?.pendingHigh ?? 0) > 0;
      if (busy) sawBusy = true;
      lastErr = st.fsaQueue?.lastError ?? lastErr;
      if (!busy && i >= 1) {
        expect(
          "S3 задача завершилась с summary или error (понятным)",
          Boolean(st.fsaQueue?.lastSummary) || Boolean(st.fsaQueue?.lastError),
          `summary=${st.fsaQueue?.lastSummary} err=${st.fsaQueue?.lastError}`
        );
        break;
      }
    }
    expect("S3 хотя бы раз был busy-статус", sawBusy);
  } else {
    expect(
      "S3 отказ без запуска (кулдаун/блок tochka) — ок",
      Boolean(lastErr),
      String(lastErr)
    );
  }
  if (lastErr) {
    expect("S4 lastError без технарщины", !hasTechLeak(lastErr), lastErr.slice(0, 120));
  } else {
    expect("S4 нет lastError или он чистый", true);
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} passed`);
  if (failed.length) {
    console.error(
      "FAILED:\n" + failed.map((f) => `- ${f.name}: ${f.detail || ""}`).join("\n")
    );
    process.exit(1);
  }
  console.log("all tochka admin scenarios ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
