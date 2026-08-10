/**
 * Тест checko через Playwright + запись в очередь new_registrations.
 * Запуск: npx tsx scripts/outreach/test-checko-append-100.mts
 *
 * CHECKO_TEST_MAX=5 — сколько карточек (по умолчанию 5, не 100 — быстрее)
 */
import {
  getNewRegistrationsRange,
  ruDateToIso,
  scanCheckoNewRegistrations,
} from "../../src/lib/outreach/checko";
import { bulkLoadList, listResultToQueue } from "../../src/lib/outreach/bulk-load";
import { writeOutreachQueue, readOutreachQueue } from "../../src/lib/outreach/queue";

async function main() {
  const range = getNewRegistrationsRange();
  const maxItems = Math.min(
    Math.max(Number(process.env.CHECKO_TEST_MAX || 5), 1),
    100
  );

  console.log("=== WINDOW ===");
  console.log({
    rangeRu: range,
    rangeIso: { from: ruDateToIso(range.from), to: ruDateToIso(range.to) },
    maxItems,
    engine: "playwright",
  });

  console.log("\n=== PLAYWRIGHT SCAN (list + cards) ===");
  const scan = await scanCheckoNewRegistrations({
    dateFrom: ruDateToIso(range.from),
    dateTo: ruDateToIso(range.to),
    emailsOnly: true,
    maxItems,
    delayMs: 400,
    onPage: (p) =>
      console.log(
        `list page ${p.page}: ${p.from}-${p.to}/${p.total}, links=${p.items.length}`
      ),
  });

  console.log({
    totalListed: scan.totalListed,
    companies: scan.companies.length,
    withEmail: scan.companies.filter((c) => c.email).length,
    nextPage: scan.nextPage,
    hasMore: scan.hasMore,
    sample: scan.companies.slice(0, 3).map((c) => ({
      name: c.shortName,
      email: c.email,
      reg: c.registrationDateRu,
    })),
  });

  if (scan.totalListed === 0) {
    console.log(
      "\nОкно: последние 21 день (сегодня−21…сегодня)."
    );
    console.log("UI «Догрузить 100» тоже получит 0, пока не появятся регистрации.");
    return;
  }

  console.log("\n=== WRITE QUEUE (как кнопка догрузки) ===");
  const result = await bulkLoadList({
    category: "new_registrations",
    mode: "reset",
    maxItems,
    range,
  });
  const queue = listResultToQueue(result, {
    mode: "reset",
    category: "new_registrations",
  });
  writeOutreachQueue(queue);

  const saved = readOutreachQueue("new_registrations");
  console.log({
    addedNew: result.addedNew,
    emailsFromList: result.emailsFromList,
    items: saved?.items.length ?? 0,
    rejected: saved?.rejected.length ?? 0,
    enrich: saved?.enrichQueue.length ?? 0,
    scannedAt: saved?.scannedAt,
    file: "data/outreach-new-registrations-queue.json",
  });

  console.log("\nok — обнови вкладку «Новые организации» в админке");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
