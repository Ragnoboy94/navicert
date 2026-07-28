/**
 * Проверка через тот же код, что scan API (rss certificates vs rds declarations).
 * Без отправки писем. Не печатает токен.
 */
import { config } from "dotenv";
import path from "path";
import {
  searchExpiringCertificates,
  searchExpiringDeclarations,
} from "../../src/lib/outreach/fsa";
import { getExpiringMonthRange } from "../../src/lib/outreach/queue";
import { ruDateToIso } from "../../src/lib/outreach/fsa-pagination";
import { formatFsaConnectionError } from "../../src/lib/outreach/fsa-connection";

config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const range = getExpiringMonthRange();
  const filter = {
    endDateFrom: ruDateToIso(range.from),
    endDateTo: ruDateToIso(range.to),
    page: 0,
    size: 5,
  };
  console.log("range", range, filter);

  try {
    const decls = await searchExpiringDeclarations(filter);
    console.log("declarations", {
      ok: true,
      count: decls.length,
      sample: decls[0]
        ? { id: decls[0].id, number: decls[0].number, endDate: decls[0].endDate }
        : null,
    });
  } catch (error) {
    console.log("declarations", {
      ok: false,
      raw: error instanceof Error ? error.message.slice(0, 300) : String(error),
      ui: formatFsaConnectionError(error),
    });
  }

  try {
    const certs = await searchExpiringCertificates(filter);
    console.log("certificates", {
      ok: true,
      count: certs.length,
      sample: certs[0]
        ? {
            id: certs[0].id,
            number: certs[0].number,
            endDate: certs[0].endDate,
            url: certs[0].registryUrl,
          }
        : null,
    });
  } catch (error) {
    console.log("certificates", {
      ok: false,
      raw: error instanceof Error ? error.message.slice(0, 300) : String(error),
      ui: formatFsaConnectionError(error),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
