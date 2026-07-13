import Link from "next/link";
import Image from "next/image";
import { ArrowRight, FileText } from "lucide-react";
import type { Article } from "@/lib/types";
import { articlePagePath, articlesIndexPath } from "@/lib/articles-routes";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function LatestArticle({ article }: { article: Article }) {
  return (
    <section className="section-compact surface-white">
      <div className="container-page">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-accent">
                Полезное
              </p>
              <h2 className="mt-1 text-xl font-bold sm:text-2xl">
                Свежая статья
              </h2>
            </div>
            <Link
              href={articlesIndexPath()}
              className="hidden shrink-0 text-sm font-medium text-primary hover:underline sm:inline"
            >
              Все статьи
            </Link>
          </div>

          <Link
            href={articlePagePath(article.slug)}
            className="group mt-5 flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/25 hover:shadow-md sm:flex-row"
          >
            {article.image ? (
              <div className="relative aspect-[16/10] shrink-0 sm:aspect-auto sm:w-2/5 sm:min-h-[200px]">
                <Image
                  src={article.image}
                  alt=""
                  fill
                  className="object-cover transition duration-300 group-hover:scale-[1.02]"
                  sizes="(max-width: 640px) 100vw, 320px"
                  unoptimized
                />
              </div>
            ) : (
              <div className="flex aspect-[16/10] shrink-0 items-center justify-center bg-accent-soft text-primary sm:aspect-auto sm:w-2/5 sm:min-h-[200px]">
                <FileText className="h-12 w-12 opacity-50" />
              </div>
            )}
            <div className="flex flex-1 flex-col justify-center p-5 sm:p-6 lg:p-8">
              <time
                dateTime={article.publishedAt}
                className="text-xs font-medium text-muted"
              >
                {formatDate(article.publishedAt)}
              </time>
              <h3 className="mt-2 text-lg font-bold leading-snug group-hover:text-primary sm:text-xl">
                {article.title}
              </h3>
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted sm:line-clamp-3">
                {article.excerpt}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Читать статью
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>

          <Link
            href={articlesIndexPath()}
            className="mt-4 inline-flex text-sm font-medium text-primary hover:underline sm:hidden"
          >
            Все статьи
          </Link>
        </div>
      </div>
    </section>
  );
}
