import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { articlesIndexPath, articlePagePath, articlePageUrl, articlesIndexUrl } from "@/lib/articles-routes";
import { isArticlePublished } from "@/lib/article-publish";
import {
  contentFiles,
  readContentFile,
  writeContentFile,
} from "@/lib/content";
import { notifySearchEngines } from "@/lib/search-indexing";
import type { Article } from "@/lib/types";

function revalidateSiteContent(file: string, data: unknown) {
  revalidatePath("/", "layout");
  revalidatePath("/uslugi");
  revalidatePath("/produkciya");
  revalidatePath(articlesIndexPath());
  revalidatePath("/privacy");
  revalidatePath("/feed.xml");
  revalidatePath("/sitemap.xml");

  if (file === "services.json" && Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && "slug" in item) {
        revalidatePath(`/uslugi/${String(item.slug)}`);
      }
    }
  }

  if (file === "categories.json" && Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && "slug" in item) {
        revalidatePath(`/produkciya/${String(item.slug)}`);
      }
    }
  }

  if (file === "articles.json" && Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && "slug" in item) {
        revalidatePath(articlePagePath(String(item.slug)));
      }
    }
  }
}

function notifyPublishedArticles(data: unknown) {
  if (!Array.isArray(data)) return;
  const urls = data
    .filter(
      (item): item is Article =>
        Boolean(item && typeof item === "object" && "slug" in item)
    )
    .filter((article) => isArticlePublished(article))
    .map((article) => articlePageUrl(article.slug));
  urls.push(articlesIndexUrl());
  notifySearchEngines(urls);
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  if (!file) {
    return NextResponse.json({ files: contentFiles });
  }

  try {
    const data = readContentFile(file);
    return NextResponse.json({ file, data });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { file, data } = await request.json();
    if (!file || data === undefined) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    writeContentFile(file, data);
    revalidateSiteContent(file, data);
    if (file === "articles.json") {
      notifyPublishedArticles(data);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
