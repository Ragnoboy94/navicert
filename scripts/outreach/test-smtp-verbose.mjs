#!/usr/bin/env node
/** Full SMTP test via SOCKS5 → Yandex:587, verbose output. */
import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SocksClient } from "socks";

function env(name) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim();
}

const proxyRaw = env("OUTREACH_SMTP_PROXY") || "socks5://95.84.138.196:1080";
const proxyUrl = new URL(proxyRaw.includes("://") ? proxyRaw : `socks5://${proxyRaw}`);
const host = env("OUTREACH_SMTP_HOST") || "smtp.yandex.ru";
const user = env("OUTREACH_SMTP_USER");
const pass = env("OUTREACH_SMTP_PASS");
const from = env("OUTREACH_SMTP_FROM") || user;
const to = env("OUTREACH_TEST_EMAIL") || "still-1994@mail.ru";
const testMode = env("OUTREACH_TEST_MODE") !== "false";

const stamp = new Date().toISOString();
const subject = `Нависерт — тест outreach ${stamp.slice(0, 16).replace("T", " ")}`;
const text = [
  "Здравствуйте!",
  "",
  "Это тестовое письмо рассылки Нависерт (outreach).",
  "Если вы видите это письмо — SMTP через SOCKS5 и Yandex:587 работает.",
  "",
  `Время: ${stamp}`,
  `testMode: ${testMode}`,
  `from: ${from}`,
  `to: ${to}`,
].join("\n");

console.log("--- config ---");
console.log(JSON.stringify({
  proxy: proxyRaw,
  host,
  port: 587,
  from,
  to,
  user,
  testMode,
}, null, 2));

const transporter = nodemailer.createTransport({
  host,
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user, pass },
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 60_000,
  tls: { servername: "smtp.yandex.ru", minVersion: "TLSv1.2" },
  logger: true,
  debug: true,
  getSocket: (options, callback) => {
    console.error(`[socks] connect → ${options.host}:${options.port} via ${proxyUrl.hostname}:${proxyUrl.port}`);
    SocksClient.createConnection({
      proxy: {
        host: proxyUrl.hostname,
        port: Number(proxyUrl.port || "1080"),
        type: 5,
      },
      command: "connect",
      destination: { host: options.host, port: options.port },
      timeout: 20_000,
    })
      .then((info) => {
        console.error("[socks] tunnel OK");
        callback(null, { connection: info.socket });
      })
      .catch((error) => {
        console.error("[socks] tunnel FAIL:", error.message);
        callback(error instanceof Error ? error : new Error(String(error)));
      });
  },
});

try {
  console.log("--- sending ---");
  const info = await transporter.sendMail({
    from: `"Андрей Громов" <${from}>`,
    to,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, "<br>")}</p>`,
  });
  console.log("--- result ---");
  console.log(JSON.stringify({
    ok: true,
    messageId: info.messageId,
    response: info.response,
    accepted: info.accepted,
    rejected: info.rejected,
    to,
  }, null, 2));
} catch (error) {
  const e = error;
  console.log("--- result ---");
  console.log(JSON.stringify({
    ok: false,
    code: e?.code,
    responseCode: e?.responseCode,
    command: e?.command,
    message: e?.message,
    response: e?.response,
  }, null, 2));
  process.exit(1);
}
