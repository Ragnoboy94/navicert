import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { playwrightEnv } from "./playwright-env";

const tokenPath = path.join(process.cwd(), "data", "fsa-token.json");

type CachedToken = {
  token: string;
  fetchedAt: string;
  expiresAt: string | null;
};

function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
      exp?: number;
    };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function readCachedToken(): CachedToken | null {
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as CachedToken;
  } catch {
    return null;
  }
}

function writeCachedToken(token: string): void {
  const dir = path.dirname(tokenPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const exp = decodeJwtExp(token);
  const cached: CachedToken = {
    token,
    fetchedAt: new Date().toISOString(),
    expiresAt: exp ? new Date(exp).toISOString() : null,
  };
  fs.writeFileSync(tokenPath, JSON.stringify(cached, null, 2) + "\n");
}

function isTokenFresh(cached: CachedToken): boolean {
  if (!cached.expiresAt) return true;
  return Date.parse(cached.expiresAt) > Date.now() + 60_000;
}

function captureTokenViaPlaywright(): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = path.join(
      process.cwd(),
      "scripts",
      "outreach",
      "get-fsa-token.mjs"
    );
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
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

    child.on("close", (code) => {
      const jsonStart = stdout.indexOf("{");
      if (jsonStart >= 0) {
        try {
          const payload = JSON.parse(stdout.slice(jsonStart)) as { token: string };
          if (payload.token) {
            resolve(payload.token);
            return;
          }
        } catch {
          // fall through
        }
      }
      reject(
        new Error(
          stderr.trim() ||
            `get-fsa-token exited with ${code} — запустите npm run outreach:setup`
        )
      );
    });
  });
}

export async function acquireFsaBearerToken(): Promise<string> {
  const fromEnv = process.env.FSA_BEARER_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const cached = readCachedToken();
  if (cached && isTokenFresh(cached)) return cached.token;

  try {
    const token = await captureTokenViaPlaywright();
    writeCachedToken(token);
    return token;
  } catch (error) {
    if (cached?.token) {
      return cached.token;
    }
    throw error;
  }
}
