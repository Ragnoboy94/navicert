/**
 * Live local FSA: token + search + append load.
 * Run: npx tsx scripts/verify-fsa-live-local.ts
 */
import { config } from "dotenv";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });

import { bulkLoadList } from "../src/lib/outreach/bulk-load";
import { formatFsaConnectionError, ensureFsaSession } from "../src/lib/outreach/fsa-connection";
import { searchExpiringDeclarations } from "../src/lib/outreach/fsa";
import { getExpiringMonthRange } from "../src/lib/outreach/queue";
import { ruDateToIso } from "../src/lib/outreach/bulk-load";

async function main() {
  console.log("=== FSA live local ===\n");

  try {
    const session = await ensureFsaSession();
    console.log("session:", session.transport.mode, "token:", session.tokenSource);
  } catch (e) {
    console.error("SESSION FAIL:", formatFsaConnectionError(e));
    process.exit(1);
  }

  const range = getExpiringMonthRange();
  const endDateFrom = ruDateToIso(range.from);
  const endDateTo = ruDateToIso(range.to);

  try {
    const batch = await searchExpiringDeclarations({
      endDateFrom,
      endDateTo,
      page: 0,
      size: 10,
      sort: ["endDate,asc"],
    });
    console.log("search:", batch.length, "items");
    if (batch[0]) {
      console.log("sample:", batch[0].id, batch[0].productName?.slice(0, 40));
    }
  } catch (e) {
    console.error("SEARCH FAIL:", formatFsaConnectionError(e));
    process.exit(1);
  }

  try {
    const result = await bulkLoadList({ mode: "reset", maxItems: 15, pageSize: 15 });
    console.log("bulkLoad reset:", {
      loadedFromApi: result.loadedFromApi,
      eligible: result.items.length,
      rejected: result.rejected.length,
      enrichPending: result.enrichQueue.length,
    });
  } catch (e) {
    console.error("BULK FAIL:", formatFsaConnectionError(e));
    process.exit(1);
  }

  console.log("cooldown 5s before append...");
  await new Promise((r) => setTimeout(r, 5000));

  try {
    const append = await bulkLoadList({
      mode: "append",
      maxItems: 10,
      pageSize: 10,
      existingQueue: {
        range: getExpiringMonthRange(),
        items: [],
        rejected: [],
        enrichQueue: [],
        nextApiPage: 0,
        pageSize: 15,
        hasMore: true,
        paginationVersion: 2,
        apiCursor: { page: 0, sortIndex: 0, sliceIndex: 0 },
      },
    });
    console.log("bulkLoad append:", {
      addedNew: append.addedNew,
      loadedFromApi: append.loadedFromApi,
    });
  } catch (e) {
    console.error("APPEND FAIL:", formatFsaConnectionError(e));
    process.exit(1);
  }

  console.log("\n--- local FSA ok ---");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
