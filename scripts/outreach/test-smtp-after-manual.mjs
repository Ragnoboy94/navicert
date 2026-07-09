#!/usr/bin/env node
/** Retest SMTP after manual web send — real outreach template. */
import nodemailer from "nodemailer";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { SocksClient } from "socks";

function env(name) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim();
}

const proxyUrl = new URL(env("OUTREACH_SMTP_PROXY") || "socks5://95.84.138.196:1080");

const declaration = {
  id: 999999,
  number: "TEST",
  registrationDate: "01.01.2024",
  endDate: "31.07.2026",
  productName: "Тестовая продукция",
  productGroup: "Пищевая продукция",
  applicant: {
    shortName: "ООО Тест",
    fullName: "ООО Тест",
    email: "test@example.com",
  },
};

// Minimal template without Next.js content loader
const subject = `Мониторинг реестра ФСА: истечение сроков действия документации ООО Тест`;
const text = [
  "Уважаемые руководители компании ООО Тест!",
  "",
  "Экспертный центр сертификации Нависерт в рамках планового мониторинга открытых данных реестра Росаккредитации зафиксировал, что у вашей организации в ближайшее время завершается период действия разрешительной документации.",
  "",
  "https://navicert.pro / +7 (800) 000-00-00",
].join("\n");

const from = env("OUTREACH_SMTP_FROM") || env("OUTREACH_SMTP_USER");
const to = env("OUTREACH_TEST_EMAIL") || "still-1994@mail.ru";
const user = env("OUTREACH_SMTP_USER");
const pass = env("OUTREACH_SMTP_PASS");

const transporter = nodemailer.createTransport({
  host: env("OUTREACH_SMTP_HOST") || "smtp.yandex.ru",
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user, pass },
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  tls: { servername: "smtp.yandex.ru", minVersion: "TLSv1.2" },
  getSocket: (options, callback) => {
    SocksClient.createConnection({
      proxy: { host: proxyUrl.hostname, port: Number(proxyUrl.port || "1080"), type: 5 },
      command: "connect",
      destination: { host: options.host, port: options.port },
      timeout: 20_000,
    })
      .then((info) => callback(null, { connection: info.socket }))
      .catch((e) => callback(e));
  },
});

try {
  const info = await transporter.sendMail({
    from: `"Андрей Громов" <${from}>`,
    to,
    subject,
    text,
    headers: {
      "List-Unsubscribe": `<https://navicert.pro/outreach/unsubscribe>`,
      Precedence: "bulk",
    },
  });
  console.log(JSON.stringify({ ok: true, messageId: info.messageId, response: info.response }, null, 2));
} catch (error) {
  const e = error;
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
