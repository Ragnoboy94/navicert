/**
 * Child-process worker for checko scan (Playwright).
 * Next.js in-process launch often hangs / picks Cursor sandbox browser path.
 *
 * Usage: tsx scripts/outreach/scan-checko-worker.mts '<json-options>'
 * Prints one JSON line prefixed with CHECKO_SCAN_RESULT=
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(root);
process.env.OUTREACH_CHECKO_WORKER = "1";
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, ".playwright-browsers");

const { scanCheckoNewRegistrationsInProcess } = await import(
  "../../src/lib/outreach/checko"
);

type WorkerOptions = {
  dateFrom?: string;
  dateTo?: string;
  emailsOnly?: boolean;
  listOnly?: boolean;
  maxItems?: number;
  maxPages?: number;
  startPage?: number;
  skipOgrns?: string[];
  delayMs?: number;
};

async function main() {
  const raw = process.argv[2] || "{}";
  let options: WorkerOptions = {};
  try {
    options = JSON.parse(raw) as WorkerOptions;
  } catch {
    throw new Error(`Invalid worker options JSON: ${raw.slice(0, 200)}`);
  }

  const result = await scanCheckoNewRegistrationsInProcess({
    ...options,
    listOnly: options.listOnly !== false,
    skipOgrns: options.skipOgrns,
  });

  // Marker so parent can find JSON even if Playwright logs to stdout.
  process.stdout.write(`CHECKO_SCAN_RESULT=${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.stdout.write(
    `CHECKO_SCAN_RESULT=${JSON.stringify({ ok: false, error: message })}\n`
  );
  process.exit(1);
});
