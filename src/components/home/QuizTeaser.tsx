"use client";

import { DocumentQuiz } from "@/components/DocumentQuiz";
import type { QuizConfig } from "@/lib/types";

/** Компактный квиз в блоке контактов на главной. */
export function QuizTeaser({ config }: { config: QuizConfig }) {
  return <DocumentQuiz config={config} variant="teaser" />;
}
