import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { fsaApiRequest } from "../../src/lib/outreach/fsa-connection";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: path.join(root, ".env.local") });

const id = 3602563;

async function tryGet(apiPath: string, referer: string) {
  const t0 = Date.now();
  try {
    const payload = await fsaApiRequest<unknown>("GET", apiPath, undefined, {
      refererPath: referer,
      maxAttempts: 1,
    });
    const keys =
      payload && typeof payload === "object"
        ? Object.keys(payload as object).slice(0, 15)
        : [];
    console.log("OK", { apiPath, ms: Date.now() - t0, keys });
  } catch (error) {
    console.log("FAIL", {
      apiPath,
      ms: Date.now() - t0,
      error: error instanceof Error ? error.message.slice(0, 180) : String(error),
    });
  }
}

async function main() {
  const paths = [
    [`/api/v1/rss/common/certificates/${id}`, "/rss/certificate"],
    [`/api/v1/rss/common/certificate/${id}`, "/rss/certificate"],
    [`/api/v1/rds/common/certificates/${id}`, "/rss/certificate"],
    [`/api/v1/rss/common/certificates/${id}/applicant`, "/rss/certificate"],
    [`/api/v1/rss/common/certificates/${id}/view`, "/rss/certificate"],
  ] as const;

  for (const [apiPath, referer] of paths) {
    await tryGet(apiPath, referer);
  }
}

main();
