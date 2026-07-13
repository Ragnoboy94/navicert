/**
 * Проверка изменений: статьи, FSA-подключение, append-загрузка.
 * Run: npx tsx scripts/verify-today.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { contentFiles, getArticles, getLatestArticle, getPublishedArticles } from "../src/lib/content";
import { buildArticleSeo } from "../src/lib/seo-content";
import { ArticleBodyContent } from "../src/components/ArticleBodyContent";
import { htmlToPlainText, articleBodyToEditorHtml, isLegacyArticleMarkdown, normalizeArticleHtml, sanitizeArticleHtml } from "../src/lib/article-body";
import { MarkdownContent } from "../src/lib/markdown";
import { listResultToQueue } from "../src/lib/outreach/bulk-load";
import {
  FsaConnectionError,
  formatFsaConnectionError,
} from "../src/lib/outreach/fsa-connection";
import {
  getClientIp,
  isHoneypotTriggered,
  MIN_FORM_FILL_MS,
  validateFormTiming,
} from "../src/lib/contactGuard";
import {
  HOURLY_FSA_APPEND_INTERVAL_MS,
  isHourlyFsaAppendDue,
} from "../src/lib/outreach/cron-maintenance";
import { checkRateLimit, resetRateLimits } from "../src/lib/rateLimit";

let passed = 0;
let failed = 0;

function ok(label: string, detail?: string) {
  passed++;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

function bad(label: string, detail?: string) {
  failed++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

function test(name: string, fn: () => void) {
  console.log(`\n[${name}]`);
  try {
    fn();
  } catch (e) {
    bad(name, e instanceof Error ? e.message : String(e));
  }
}

// --- Статьи ---

test("articles.json в whitelist", () => {
  assert(contentFiles.includes("articles.json"));
  ok("contentFiles");
});

test("getPublishedArticles фильтрует черновики и будущие даты", () => {
  const { todayDateIso, shiftDateIso } =
    require("../src/lib/article-publish") as typeof import("../src/lib/article-publish");
  const today = todayDateIso();
  const yesterday = shiftDateIso(today, -1);
  const tomorrow = shiftDateIso(today, 1);

  const articlesPath = path.join(process.cwd(), "content", "articles.json");
  const backup = fs.readFileSync(articlesPath, "utf-8");
  try {
    fs.writeFileSync(
      articlesPath,
      JSON.stringify(
        [
          {
            slug: "pub",
            title: "Публичная",
            excerpt: "Описание",
            body: "Текст",
            publishedAt: yesterday,
            seo: { title: "T", description: "D" },
          },
          {
            slug: "draft",
            title: "Черновик",
            excerpt: "Скрыта",
            body: "",
            publishedAt: today,
            draft: true,
            seo: { title: "T", description: "D" },
          },
          {
            slug: "future",
            title: "Будущая",
            excerpt: "Позже",
            body: "",
            publishedAt: tomorrow,
            seo: { title: "T", description: "D" },
          },
        ],
        null,
        2
      ) + "\n"
    );

    delete require.cache[require.resolve("../src/lib/article-publish")];
    delete require.cache[require.resolve("../src/lib/content")];
    const { getPublishedArticles: freshPublished, getLatestArticle: freshLatest } =
      require("../src/lib/content") as typeof import("../src/lib/content");

    const published = freshPublished();
    assert.equal(published.length, 1);
    assert.equal(published[0].slug, "pub");
    assert.equal(freshLatest()?.slug, "pub");
    ok("draft and future hidden, latest = pub");
  } finally {
    fs.writeFileSync(articlesPath, backup);
    delete require.cache[require.resolve("../src/lib/article-publish")];
    delete require.cache[require.resolve("../src/lib/content")];
  }
});

test("isArticlePublished: черновик и отложенная дата", () => {
  const { isArticlePublished, getArticlePublishStatus } =
    require("../src/lib/article-publish") as typeof import("../src/lib/article-publish");

  const base = {
    slug: "x",
    title: "T",
    excerpt: "",
    body: "",
    publishedAt: "2026-07-13",
    seo: { title: "T", description: "D" },
  };

  assert.equal(
    getArticlePublishStatus({ ...base, draft: true }, "2026-07-13"),
    "draft"
  );
  assert.equal(
    getArticlePublishStatus({ ...base, publishedAt: "2026-07-14" }, "2026-07-13"),
    "scheduled"
  );
  assert.equal(isArticlePublished(base, "2026-07-13"), true);
  assert.equal(
    isArticlePublished({ ...base, publishedAt: "2026-07-14" }, "2026-07-13"),
    false
  );
  ok("publish status by date");
});

test("buildArticleSeo", () => {
  const seo = buildArticleSeo("Сертификация косметики", "Краткий обзор документов");
  assert.match(seo.title, /косметик/i);
  assert.ok(seo.description.length > 10);
  ok("seo generated");
});

test("normalizeArticleHtml: пустые абзацы видны", () => {
  const normalized = normalizeArticleHtml(
    "<p>Абзац 1</p><p></p><p></p><p>Абзац 2</p>"
  );
  assert.match(normalized, /<p><br><\/p>/);
  const rendered = sanitizeArticleHtml(normalized);
  assert.match(rendered, /<p><br><\/p>/);
  ok("blank lines preserved");
});

test("articleBodyToEditorHtml: markdown и HTML", () => {
  assert.equal(articleBodyToEditorHtml(""), "<p></p>");
  assert.match(articleBodyToEditorHtml("<p>Hi</p>"), /^<p>Hi<\/p>$/);
  assert.match(articleBodyToEditorHtml("## Заголовок\n\nТекст"), /<p>/);
  assert.equal(isLegacyArticleMarkdown("plain text"), true);
  assert.equal(isLegacyArticleMarkdown("<p>x</p>"), false);
  ok("editor html normalization");
});

test("Markdown: ссылки, картинки, абзацы", () => {
  const md = `## Раздел

Первый абзац с [ссылкой](/uslugi/test) и **жирным**.

Второй абзац.

![Подпись](/images/test.webp)
`;
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, { text: md })
  );
  assert.match(html, /href="\/uslugi\/test"/);
  assert.match(html, /<strong>жирным<\/strong>/);
  assert.match(html, /prose-figure/);
  assert.match(html, /\/images\/test\.webp/);
  ok("markdown renders links and image");
});

test("Markdown: inline bold only marked words", () => {
  const md = "Длинный абзац про сертификацию и **одно** слово жирным.";
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, { text: md })
  );
  assert.match(html, /<strong>одно<\/strong>/);
  assert.match(html, /сертификацию и/);
  assert.doesNotMatch(html, /<strong>Длинный/);
  ok("bold stays on selected word");
});

test("Article HTML: жирный, отступ, пробелы", () => {
  const html =
    '<p class="prose-indent">Десять       пробелов сохраняются.</p><p><strong>Жирное</strong> слово</p>';
  const rendered = renderToStaticMarkup(
    React.createElement(ArticleBodyContent, { text: html })
  );
  assert.match(rendered, /prose-indent/);
  assert.match(rendered, /<strong>Жирное<\/strong>/);
  assert.match(rendered, /Десять {7}пробелов/);
  const plain = htmlToPlainText(html);
  assert.match(plain, /Десять пробелов/);
  ok("html article body renders");
});

test("Markdown: красная строка по маркеру ¶", () => {
  const md = `Простой абзац.
¶ С красной строкой.`;
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, { text: md })
  );
  assert.match(html, /prose-indent/);
  assert.doesNotMatch(html, /¶/);
  ok("indent marker toggles prose-indent");
});

test("Markdown: горизонтальная линия ---", () => {
  const md = `До

---

После`;
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, { text: md })
  );
  assert.match(html, /prose-hr/);
  assert.doesNotMatch(html, /<p>---<\/p>/);
  ok("hr renders as divider");
});

// --- FSA append vs reset ---

test("listResultToQueue append сохраняет очередь", () => {
  const existing = {
    scannedAt: "2026-01-01",
    range: { from: "01.07.2026", to: "31.08.2026" },
    category: "expiring" as const,
    paginationVersion: 2,
    nextApiPage: 5,
    apiCursor: { page: 5, sortIndex: 1, sliceIndex: 0 },
    pageSize: 100,
    hasMore: true,
    items: [{ id: 1 } as never],
    rejected: [{ id: 2 } as never],
    enrichQueue: [],
    enrichProcessedTotal: 10,
    enrichEmailsFoundTotal: 3,
  };

  const result = {
    range: existing.range,
    nextApiPage: 6,
    apiCursor: { page: 6, sortIndex: 1, sliceIndex: 0 },
    pageSize: 100,
    hasMore: true,
    items: [{ id: 1 } as never, { id: 99 } as never],
    rejected: [{ id: 2 } as never],
    enrichQueue: [],
    loadedFromApi: 100,
    addedNew: 50,
    emailsFromList: 0,
    cursorLabel: "test",
    paginationVersion: 2,
  };

  const resetQ = listResultToQueue(result, { mode: "reset" });
  assert.equal(resetQ.enrichProcessedTotal, 0);
  assert.equal(resetQ.items.length, 2);

  const appendQ = listResultToQueue(result, { mode: "append", existing });
  assert.equal(appendQ.enrichProcessedTotal, 10);
  assert.equal(appendQ.enrichEmailsFoundTotal, 3);
  assert.equal(appendQ.apiCursor?.page, 6);
  ok("reset clears stats, append keeps stats");
});

test("FSA connection errors", () => {
  const err = new FsaConnectionError("token", "Токен не получен");
  assert.equal(formatFsaConnectionError(err), err.message);
  assert.match(formatFsaConnectionError(new Error("FSA → 401")), /токен|сессия/i);
  ok("error formatting");
});

// --- Защита формы ---

test("contact guard", () => {
  assert.equal(isHoneypotTriggered(""), false);
  assert.equal(isHoneypotTriggered("bot"), true);
  assert.equal(validateFormTiming(Date.now() - 500), "too_fast");
  assert.equal(validateFormTiming(Date.now() - MIN_FORM_FILL_MS - 100), "ok");

  resetRateLimits();
  assert.equal(checkRateLimit("ip-x", 2, 60_000), true);
  assert.equal(checkRateLimit("ip-x", 2, 60_000), true);
  assert.equal(checkRateLimit("ip-x", 2, 60_000), false);

  const req = new Request("http://localhost/api/contact", {
    headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
  });
  assert.equal(getClientIp(req), "203.0.113.1");
  ok("honeypot, timing, rate limit, IP");
});

test("hourly FSA append interval", () => {
  const now = Date.now();
  assert.equal(isHourlyFsaAppendDue(null, now), true);
  assert.equal(
    isHourlyFsaAppendDue(new Date(now - HOURLY_FSA_APPEND_INTERVAL_MS + 1000).toISOString(), now),
    false
  );
  assert.equal(
    isHourlyFsaAppendDue(new Date(now - HOURLY_FSA_APPEND_INTERVAL_MS - 1000).toISOString(), now),
    true
  );
  ok("60 min throttle");
});

// --- HTTP (dev server) ---

async function testHttp() {
  console.log("\n[HTTP integration]");
  const base = process.env.VERIFY_BASE_URL || "http://localhost:3000";

  async function get(path: string) {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  }

  try {
    const home = await get("/");
    if (home.status !== 200) bad("GET /", String(home.status));
    else ok("GET /", "200");

    const blog = await get("/blog");
    if (blog.status !== 200) bad("GET /blog", String(blog.status));
    else ok("GET /blog", "200");

    const oldStati = await get("/stati");
    if (oldStati.status !== 200 && oldStati.status !== 308 && oldStati.status !== 301) {
      bad("GET /stati redirect", String(oldStati.status));
    } else ok("GET /stati", "redirects to /blog");

    const feed = await get("/feed.xml");
    if (feed.status !== 200) bad("GET /feed.xml", String(feed.status));
    else if (!feed.text.includes("<rss")) bad("GET /feed.xml", "not RSS");
    else ok("GET /feed.xml", "valid RSS");

    const sitemap = await get("/sitemap.xml");
    if (sitemap.status !== 200) bad("GET /sitemap.xml", String(sitemap.status));
    else if (!sitemap.text.includes("/blog")) bad("GET /sitemap.xml", "no /blog");
    else ok("GET /sitemap.xml", "includes /blog");

    const honeypot = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Бот",
        phone: "+79001234567",
        consent: true,
        company: "spam",
        formOpenedAt: Date.now() - 5000,
      }),
    });
    const honeypotBody = await honeypot.json();
    if (honeypot.status !== 200 || honeypotBody.id !== "accepted")
      bad("honeypot API", JSON.stringify(honeypotBody));
    else ok("honeypot returns fake success");

    const fast = await fetch(`${base}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Иван",
        phone: "+79001234567",
        consent: true,
        company: "",
        formOpenedAt: Date.now() - 100,
      }),
    });
    if (fast.status !== 400) bad("too_fast API", String(fast.status));
    else ok("too_fast rejected");

    const loginRes = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || "navicert2025" }),
    });
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const match = setCookie.match(/navicert_admin=([^;]+)/);
    if (!match) {
      bad("admin login", "no cookie");
    } else {
      const cookie = `navicert_admin=${match[1]}`;
      const filesRes = await fetch(`${base}/api/admin/content`, {
        headers: { cookie },
      });
      const filesJson = (await filesRes.json()) as { files?: string[] };
      if (!filesRes.ok || !filesJson.files?.includes("articles.json"))
        bad("admin content files", JSON.stringify(filesJson));
      else ok("admin API lists articles.json");

      const articlesRes = await fetch(
        `${base}/api/admin/content?file=articles.json`,
        { headers: { cookie } }
      );
      if (!articlesRes.ok) bad("admin load articles.json", String(articlesRes.status));
      else ok("admin load articles.json");
    }
  } catch (e) {
    if (e instanceof Error && /ECONNREFUSED|fetch failed/i.test(e.message)) {
      console.log("  ⚠ HTTP skipped — start: npm run dev");
    } else {
      bad("HTTP", e instanceof Error ? e.message : String(e));
    }
  }
}

async function main() {
  console.log("Verify today's changes\n");
  await testHttp();
  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
