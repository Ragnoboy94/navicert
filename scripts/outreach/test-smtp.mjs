#!/usr/bin/env node
/** Smoke test: Yandex SMTP on 587 via OUTREACH_SMTP_PROXY (SOCKS5). */
import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SocksClient } from "socks";

function env(name) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim();
}

const proxyRaw = env("OUTREACH_SMTP_PROXY");
if (!proxyRaw) {
  console.error(JSON.stringify({ ok: false, err: "OUTREACH_SMTP_PROXY missing" }));
  process.exit(1);
}

const proxyUrl = new URL(proxyRaw.includes("://") ? proxyRaw : `socks5://${proxyRaw}`);
const host = env("OUTREACH_SMTP_HOST");
const user = env("OUTREACH_SMTP_USER");
const pass = env("OUTREACH_SMTP_PASS");
const from = env("OUTREACH_SMTP_FROM") || user;
const to = env("OUTREACH_TEST_EMAIL") || "still-1994@mail.ru";

const transporter = nodemailer.createTransport({
  host,
  port: Number(env("OUTREACH_SMTP_PORT") || "587"),
  secure: false,
  requireTLS: true,
  auth: { user, pass },
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  getSocket: (options, callback) => {
    SocksClient.createConnection({
      proxy: {
        host: proxyUrl.hostname,
        port: Number(proxyUrl.port || "1080"),
        type: 5,
      },
      command: "connect",
      destination: { host: options.host, port: options.port },
      timeout: 15_000,
    })
      .then((info) => callback(null, { connection: info.socket }))
      .catch((error) => callback(error instanceof Error ? error : new Error(String(error))));
  },
});

try {
  const info = await transporter.sendMail({
    from: `"Navicert test" <${from}>`,
    to,
    subject: "outreach yandex 587 test",
    text: `SMTP test ${new Date().toISOString()}`,
  });
  console.log(JSON.stringify({ ok: true, messageId: info.messageId, to }));
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      err: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
}
