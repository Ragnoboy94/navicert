/**
 * E2E: статья через админ API + нормальная заявка.
 * Run: npx tsx scripts/verify-today-e2e.ts
 */
const base = process.env.VERIFY_BASE_URL || "http://localhost:3000";
const password = process.env.ADMIN_PASSWORD || "navicert2025";

let failed = 0;

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function bad(msg: string, detail?: string) {
  failed++;
  console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ""}`);
}

async function login(): Promise<string | null> {
  const res = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/navicert_admin=([^;]+)/);
  return match ? `navicert_admin=${match[1]}` : null;
}

async function main() {
  console.log("E2E verify\n");

  const cookie = await login();
  if (!cookie) {
    bad("admin login");
    process.exit(1);
  }
  ok("admin login");

  const testArticle = {
    slug: "test-verify-statya",
    title: "Тестовая статья (автотест)",
    excerpt: "Краткое описание для проверки раздела статей.",
    body: "## Раздел\n\nПараграф с [ссылкой](/uslugi) и **жирным**.\n\nВторой абзац.",
    publishedAt: "2026-07-13",
    seo: {
      title: "Тестовая статья — Нависерт",
      description: "Автотест раздела статей.",
    },
  };

  const saveRes = await fetch(`${base}/api/admin/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ file: "articles.json", data: [testArticle] }),
  });
  if (!saveRes.ok) bad("save article", await saveRes.text());
  else ok("save article via admin API");

  const pageRes = await fetch(`${base}/blog/${testArticle.slug}`);
  const pageHtml = await pageRes.text();
  if (pageRes.status !== 200) bad("article page", String(pageRes.status));
  else if (!pageHtml.includes(testArticle.title)) bad("article page", "no title");
  else if (!pageHtml.includes("жирным")) bad("article page", "no markdown body");
  else ok("article page renders");

  const homeRes = await fetch(`${base}/`);
  const homeHtml = await homeRes.text();
  if (!homeHtml.includes("Свежая статья") || !homeHtml.includes(testArticle.title))
    bad("homepage preview", "missing latest article block");
  else ok("homepage shows latest article");

  const feedRes = await fetch(`${base}/feed.xml`);
  const feedXml = await feedRes.text();
  if (!feedXml.includes(testArticle.slug)) bad("RSS feed", "article not in feed");
  else ok("RSS includes article");

  const normalRes = await fetch(`${base}/api/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.88",
    },
    body: JSON.stringify({
      name: "Тест Проверка",
      phone: "+79037654321",
      email: "verify@example.com",
      message: "Автотест заявки",
      consent: true,
      company: "",
      formOpenedAt: Date.now() - 8000,
      source: "verify-today-e2e",
    }),
  });
  const normalBody = (await normalRes.json()) as { success?: boolean; id?: string };
  if (normalRes.status !== 200 || !normalBody.success || normalBody.id === "accepted")
    bad("normal contact", JSON.stringify(normalBody));
  else ok("normal contact accepted");

  const cleanupRes = await fetch(`${base}/api/admin/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ file: "articles.json", data: [] }),
  });
  if (!cleanupRes.ok) bad("cleanup articles", await cleanupRes.text());
  else ok("cleanup articles.json");

  const homeAfter = await fetch(`${base}/`);
  const homeAfterHtml = await homeAfter.text();
  if (homeAfterHtml.includes("Свежая статья"))
    bad("homepage after cleanup", "preview still visible");
  else ok("homepage hides preview when no articles");

  console.log(`\n--- ${failed === 0 ? "all passed" : `${failed} failed`} ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
