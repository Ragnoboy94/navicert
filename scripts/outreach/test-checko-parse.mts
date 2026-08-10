/**
 * Проверка парсера checko.ru без SMTP и без записи очереди.
 * Запуск: npx tsx scripts/outreach/test-checko-parse.mts
 *
 * По умолчанию берёт окно сегодня−21…сегодня (последние 21 день).
 * Для узкого демо: CHECKO_TEST_FROM=2026-08-01 CHECKO_TEST_TO=2026-08-07
 */
import {
  getNewRegistrationsRange,
  ruDateToIso,
  scanCheckoNewRegistrations,
} from "../../src/lib/outreach/checko";

async function main() {
  const defaultRange = getNewRegistrationsRange();
  const dateFrom =
    process.env.CHECKO_TEST_FROM?.trim() || ruDateToIso(defaultRange.from);
  const dateTo =
    process.env.CHECKO_TEST_TO?.trim() || ruDateToIso(defaultRange.to);
  const maxItems = Math.min(
    Math.max(Number(process.env.CHECKO_TEST_MAX || 5), 1),
    20
  );

  console.log(`checko range ${dateFrom} .. ${dateTo}, max=${maxItems}`);

  const result = await scanCheckoNewRegistrations({
    dateFrom,
    dateTo,
    listOnly: true,
    emailsOnly: false,
    maxItems,
    delayMs: Number(process.env.OUTREACH_CHECKO_DELAY_MS || 1800),
    onPage: (page) => {
      console.log(
        `page ${page.page}: ${page.from}-${page.to} / ${page.total}, links=${page.items.length}`
      );
    },
  });

  console.log(
    `done: listed=${result.totalListed}, fetched=${result.companies.length}, pages=${result.pagesFetched}`
  );

  for (const company of result.companies) {
    const first = company.email || "(no email)";
    const extra =
      company.emails.length > 1
        ? ` (+${company.emails.length - 1} skipped: ${company.emails.slice(1).join(", ")})`
        : "";
    console.log(
      [
        company.shortName || "?",
        `OGRN ${company.ogrn}`,
        `INN ${company.inn || "?"}`,
        `reg ${company.registrationDateRu || company.registrationDateIso || "?"}`,
        `email ${first}${extra}`,
        company.url,
      ].join(" | ")
    );
  }

  if (result.totalListed > 0 && result.companies.length === 0) {
    throw new Error("Список не пуст, но карточки не распарсились");
  }

  const withEmail = result.companies.filter((c) => c.email);
  if (result.companies.length > 0 && withEmail.length === 0) {
    console.warn("Внимание: ни у одной карточки не найден email");
  }

  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
