import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, ".playwright-browsers");

function run(args) {
  return spawnSync("npx", args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
}

// Linux VPS: без системных libatk/libgbm Chromium не стартует
if (process.platform === "linux") {
  const deps = run(["playwright", "install-deps", "chromium"]);
  if (deps.status !== 0) {
    console.error(
      "playwright install-deps failed — на сервере нужен root: npx playwright install-deps chromium"
    );
    process.exit(deps.status ?? 1);
  }
}

const result = run(["playwright", "install", "chromium"]);
process.exit(result.status ?? 1);
