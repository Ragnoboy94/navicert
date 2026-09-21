import { buildLlmsTxt, llmsTxtResponse } from "@/lib/llms-txt";

export const dynamic = "force-static";

export function GET() {
  return llmsTxtResponse(buildLlmsTxt());
}
