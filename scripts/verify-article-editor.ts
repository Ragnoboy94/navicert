/**
 * Сценарий статьи в HTML (Tiptap): публикация и рендер на сайте.
 * Run: npx tsx scripts/verify-article-editor.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleBodyContent } from "../src/components/ArticleBodyContent";
import { htmlToPlainText } from "../src/lib/article-body";

let failed = 0;

function step(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("Сценарий: статья про косметику (HTML)\n");

const body = `<h2>Сертификация косметики</h2><p>Косметика проходит оценку соответствия.</p><p class="prose-indent"><strong>Декларация</strong> оформляется на серию.</p><p>Десять       пробелов в строке.</p><hr><p>Заключение.</p>`;

step("1. HTML рендерится на сайте", () => {
  const html = renderToStaticMarkup(
    React.createElement(ArticleBodyContent, { text: body })
  );
  assert.match(html, /<h2>/);
  assert.match(html, /<strong>Декларация<\/strong>/);
  assert.match(html, /prose-indent/);
  assert.match(html, /<hr/);
});

step("2. Пробелы не схлопываются в plain text для SEO", () => {
  const plain = htmlToPlainText(body);
  assert.match(plain, /Десять пробелов/);
});

async function httpCheck() {
  const base = process.env.VERIFY_BASE_URL || "http://localhost:3000";
  const password = process.env.ADMIN_PASSWORD || "navicert2025";

  const loginRes = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const cookie = (loginRes.headers.get("set-cookie") || "").match(
    /navicert_admin=[^;]+/
  )?.[0];
  if (!cookie) throw new Error("admin login failed");

  const article = {
    slug: "test-editor-kosmetika",
    title: "Сертификация косметики — тест",
    excerpt: "HTML-статья из редактора.",
    body,
    publishedAt: "2026-07-13",
    seo: {
      title: "Сертификация косметики — тест — Нависерт",
      description: "HTML-статья из редактора.",
    },
  };

  const saveRes = await fetch(`${base}/api/admin/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ file: "articles.json", data: [article] }),
  });
  if (!saveRes.ok) throw new Error(`save failed: ${saveRes.status}`);

  const pageRes = await fetch(`${base}/blog/${article.slug}`);
  const pageHtml = await pageRes.text();
  assert.match(pageHtml, /<strong>Декларация<\/strong>/);
  assert.match(pageHtml, /prose-indent/);

  await fetch(`${base}/api/admin/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ file: "articles.json", data: [] }),
  });
}

console.log(`\n--- ${failed === 0 ? "сценарий пройден" : `${failed} ошибок`} ---`);

if (failed === 0) {
  httpCheck()
    .then(() => {
      console.log("  ✓ опубликовано на /blog");
      process.exit(0);
    })
    .catch((e) => {
      console.log(`  ✗ HTTP: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
} else {
  process.exit(1);
}
