import { NextResponse } from "next/server";
import { getQuiz } from "@/lib/content";

/** Публичный конфиг квиза для виджета чата. */
export async function GET() {
  return NextResponse.json({ quiz: getQuiz() });
}
