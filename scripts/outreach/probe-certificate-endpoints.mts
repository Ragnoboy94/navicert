/**
 * Пробует варианты certificate API тем же транспортом/токеном, что declarations.
 * Не печатает токен. Только status/path/body-shape.
 *
 * Запуск: npx tsx scripts/outreach/probe-certificate-endpoints.mts
 */
import { config } from "dotenv";
import path from "path";
import { ensureFsaSession, fsaApiRequest } from "../../src/lib/outreach/fsa-connection";
import { getExpiringMonthRange } from "../../src/lib/outreach/queue";
import { ruDateToIso } from "../../src/lib/outreach/fsa-pagination";

config({ path: path.join(process.cwd(), ".env.local") });

function toIsoRange() {
  const range = getExpiringMonthRange();
  return {
    from: ruDateToIso(range.from),
    to: ruDateToIso(range.to),
    range,
  };
}

async function tryPost(
  pathName: string,
  body: unknown,
  refererPath: string
): Promise<void> {
  const started = Date.now();
  try {
    const payload = await fsaApiRequest<unknown>("POST", pathName, body, {
      refererPath,
      maxAttempts: 2,
    });
    const record = payload as Record<string, unknown>;
    const items =
      (Array.isArray(record.items) && record.items) ||
      (Array.isArray(record.content) && record.content) ||
      (Array.isArray((record.data as { items?: unknown[] } | undefined)?.items) &&
        (record.data as { items: unknown[] }).items) ||
      [];
    console.log(
      JSON.stringify({
        ok: true,
        ms: Date.now() - started,
        path: pathName,
        refererPath,
        keys: Object.keys(record),
        items: Array.isArray(items) ? items.length : null,
        sampleKeys:
          Array.isArray(items) && items[0] && typeof items[0] === "object"
            ? Object.keys(items[0] as object).slice(0, 20)
            : null,
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        ms: Date.now() - started,
        path: pathName,
        refererPath,
        error: error instanceof Error ? error.message.slice(0, 400) : String(error),
      })
    );
  }
}

async function main() {
  const { from, to, range } = toIsoRange();
  console.log("range", range, { from, to });

  const session = await ensureFsaSession();
  console.log("session", {
    tokenSource: session.tokenSource,
    transport: session.transport.mode,
    tokenLen: session.token.length,
  });

  const endDateFilter = {
    endDate: {
      minDate: `${from}T00:00:00.000Z`,
      maxDate: `${to}T23:59:59.999Z`,
    },
  };

  const bodies = [
    {
      name: "decl-like",
      body: {
        size: 5,
        page: 0,
        filter: endDateFilter,
        columnsSearch: [],
        sort: ["endDate"],
      },
    },
    {
      name: "certEndDate",
      body: {
        size: 5,
        page: 0,
        filter: {
          certEndDate: {
            minDate: `${from}T00:00:00.000Z`,
            maxDate: `${to}T23:59:59.999Z`,
          },
        },
        columnsSearch: [],
        sort: ["endDate"],
      },
    },
    {
      name: "validityEndDate",
      body: {
        size: 5,
        page: 0,
        filter: {
          validityEndDate: {
            minDate: `${from}T00:00:00.000Z`,
            maxDate: `${to}T23:59:59.999Z`,
          },
        },
        columnsSearch: [],
        sort: ["endDate"],
      },
    },
    {
      name: "empty-filter",
      body: {
        size: 5,
        page: 0,
        filter: {},
        columnsSearch: [],
        sort: ["id,desc"],
      },
    },
  ];

  const paths = [
    "/api/v1/rss/common/certificates/get",
    "/api/v1/rds/common/certificates/get", // legacy wrong path — ожидаем fail
    "/api/v1/rds/common/declarations/get",
  ];

  const referers = ["/rss/certificate", "/rds/declaration"];

  // Control first
  await tryPost(
    "/api/v1/rds/common/declarations/get",
    bodies[0].body,
    "/rds/declaration"
  );

  for (const pathName of paths) {
    if (pathName.includes("declarations")) continue;
    for (const refererPath of referers) {
      for (const variant of bodies.slice(0, 2)) {
        console.log(`\n--- ${variant.name} @ ${pathName} referer=${refererPath} ---`);
        await tryPost(pathName, variant.body, refererPath);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
