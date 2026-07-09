#!/usr/bin/env node
/** One informal test letter — direct SMTP if ports open, else SOCKS fallback. */
import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SocksClient } from "socks";
import net from "net";

function env(name) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim();
}

function tcpOpen(host, port, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const smtpHost = env("OUTREACH_SMTP_HOST") || "smtp.yandex.ru";
const user = env("OUTREACH_SMTP_USER");
const pass = env("OUTREACH_SMTP_PASS");
const from = env("OUTREACH_SMTP_FROM") || user;
const to = env("OUTREACH_TEST_EMAIL") || "still-1994@mail.ru";
const proxyRaw = env("OUTREACH_SMTP_PROXY");

const ports = [
  { port: 587, secure: false, requireTLS: true },
  { port: 465, secure: true, requireTLS: false },
];

let route = "direct";
for (const p of ports) {
  if (await tcpOpen(smtpHost, p.port)) {
    ports.unshift(p);
    break;
  }
}

const chosen = ports[0];
const useProxy = !(await tcpOpen(smtpHost, chosen.port));
if (useProxy && proxyRaw) route = `socks:${proxyRaw}`;

const stamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
const subject = "Проверка связи";
const text = [
  "Привет!",
  "",
  "Пишу проверить, что письма с сервера доходят нормально.",
  "Это обычное личное сообщение, не рассылка.",
  "",
  "Если получил — ответь коротко, что всё ок.",
  "",
  `Время отправки: ${stamp} (МСК)`,
  "Андрей",
].join("\n");

const transportOpts = {
  host: smtpHost,
  port: chosen.port,
  secure: chosen.secure,
  requireTLS: chosen.requireTLS,
  auth: { user, pass },
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 40_000,
  tls: { servername: smtpHost, minVersion: "TLSv1.2" },
};

if (useProxy && proxyRaw) {
  const proxyUrl = new URL(proxyRaw.includes("://") ? proxyRaw : `socks5://${proxyRaw}`);
  transportOpts.getSocket = (options, callback) => {
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
      .then((info) => callback(null, { connection: info.socket }))
      .catch((e) => callback(e));
  };
}

console.log("--- plan ---");
console.log(JSON.stringify({
  route,
  host: smtpHost,
  port: chosen.port,
  secure: chosen.secure,
  from,
  to,
  subject,
}, null, 2));

const transporter = nodemailer.createTransport(transportOpts);

try {
  const info = await transporter.sendMail({
    from: `"Андрей Громов" <${from}>`,
    to,
    subject,
    text,
  });
  console.log("--- result ---");
  console.log(JSON.stringify({
    ok: true,
    messageId: info.messageId,
    response: info.response,
    accepted: info.accepted,
    route,
  }, null, 2));
} catch (error) {
  const e = error;
  console.log("--- result ---");
  console.log(JSON.stringify({
    ok: false,
    route,
    code: e?.code,
    responseCode: e?.responseCode,
    command: e?.command,
    message: e?.message,
    response: e?.response,
  }, null, 2));
  process.exit(1);
}
