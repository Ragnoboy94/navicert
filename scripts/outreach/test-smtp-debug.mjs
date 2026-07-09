#!/usr/bin/env node
import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SocksClient } from "socks";

function env(name) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim();
}

const proxyUrl = new URL(env("OUTREACH_SMTP_PROXY"));
const getSocket = (options, callback) => {
  SocksClient.createConnection({
    proxy: { host: proxyUrl.hostname, port: Number(proxyUrl.port || "1080"), type: 5 },
    command: "connect",
    destination: { host: options.host, port: options.port },
    timeout: 20_000,
  })
    .then((info) => callback(null, { connection: info.socket }))
    .catch((e) => callback(e));
};

const transporter = nodemailer.createTransport({
  host: env("OUTREACH_SMTP_HOST"),
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user: env("OUTREACH_SMTP_USER"), pass: env("OUTREACH_SMTP_PASS") },
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  tls: { servername: "smtp.yandex.ru", minVersion: "TLSv1.2" },
  getSocket,
});

const info = await transporter.sendMail({
  from: `"Test" <${env("OUTREACH_SMTP_FROM")}>`,
  to: env("OUTREACH_TEST_EMAIL"),
  subject: "yandex 587 via socks",
  text: new Date().toISOString(),
});
console.log(JSON.stringify({ ok: true, messageId: info.messageId }));
