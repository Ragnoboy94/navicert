import { spawn } from "child_process";
import path from "path";
import { playwrightEnv } from "./playwright-env";
import type { FsaDeclaration } from "./types";

export function getEnrichLimit(): number {
  return Math.min(
    Math.max(Number(process.env.OUTREACH_ENRICH_LIMIT || 80), 10),
    200
  );
}

export function enrichApplicantsFromCards(
  declarations: FsaDeclaration[]
): Promise<FsaDeclaration[]> {
  if (declarations.length === 0) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const script = path.join(
      process.cwd(),
      "scripts",
      "outreach",
      "enrich-applicants.mjs"
    );
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: playwrightEnv(),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.stdin.write(JSON.stringify({ items: declarations }));
    child.stdin.end();

    child.on("close", (code) => {
      const jsonStart = stdout.indexOf("{");
      if (jsonStart >= 0) {
        try {
          const payload = JSON.parse(stdout.slice(jsonStart)) as {
            declarations: FsaDeclaration[];
          };
          resolve(payload.declarations ?? []);
          return;
        } catch (error) {
          reject(error);
          return;
        }
      }

      reject(
        new Error(
          stderr.trim() ||
            `enrich-applicants exited with ${code}`
        )
      );
    });
  });
}
