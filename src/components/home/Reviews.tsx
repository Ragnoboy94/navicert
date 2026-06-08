"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import type { Review } from "@/lib/types";
import { SectionHeading } from "../SectionHeading";

const DESKTOP_LIMIT = 3;

function ReviewCard({ review }: { review: Review }) {
  return (
    <article className="card flex h-full flex-col p-6 sm:p-7">
      <Quote className="mb-3 h-7 w-7 text-accent/40" aria-hidden />
      <p className="text-xs font-bold uppercase tracking-wider text-accent">
        {review.category}
      </p>
      <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-foreground sm:text-[0.9375rem]">
        «{review.text}»
      </blockquote>
      <footer className="mt-5 border-t border-border pt-4">
        <p className="font-semibold text-foreground">{review.author}</p>
        {(review.location || review.role) && (
          <p className="mt-0.5 text-sm text-muted">
            {[review.location, review.role].filter(Boolean).join(" · ")}
          </p>
        )}
      </footer>
    </article>
  );
}

export function Reviews({ reviews }: { reviews: Review[] }) {
  const [mobileIndex, setMobileIndex] = useState(0);
  const desktopReviews = reviews.slice(0, DESKTOP_LIMIT);

  return (
    <section id="otzyvy" className="section-compact surface-white">
      <div className="container-page">
        <SectionHeading label="Отзывы" title="Отзывы клиентов" />

        <div className="mt-10 hidden gap-5 md:grid md:grid-cols-2 lg:grid-cols-3">
          {desktopReviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>

        <div className="mt-10 md:hidden">
          <ReviewCard review={reviews[mobileIndex]} />
          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() =>
                setMobileIndex((i) => (i === 0 ? reviews.length - 1 : i - 1))
              }
              className="rounded-full border border-border p-3 active:bg-accent-soft"
              aria-label="Предыдущий отзыв"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex gap-2">
              {reviews.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMobileIndex(i)}
                  className={`h-2.5 rounded-full transition ${
                    i === mobileIndex ? "w-7 bg-accent" : "w-2.5 bg-border"
                  }`}
                  aria-label={`Отзыв ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setMobileIndex((i) => (i === reviews.length - 1 ? 0 : i + 1))
              }
              className="rounded-full border border-border p-3 active:bg-accent-soft"
              aria-label="Следующий отзыв"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
