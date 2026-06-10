import nodemailer from "nodemailer";
import type { Lead } from "./types";
import { getSite } from "./content";
import { formatLeadTimeLines } from "./lead-time";
import { validateLeadEmail } from "./phone";

function formatLeadText(lead: Lead): string {
  const timeLines = formatLeadTimeLines(lead.createdAt, lead.clientTimezone);

  return [
    "Новая заявка с сайта Нависерт",
    "",
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    lead.email ? `Email клиента: ${lead.email}` : null,
    lead.service ? `Услуга: ${lead.service}` : null,
    lead.message ? `Сообщение: ${lead.message}` : null,
    `Источник: ${lead.source}`,
    ...timeLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatLeadTelegramTime(lead: Lead): string {
  return formatLeadTimeLines(lead.createdAt, lead.clientTimezone).join("\n");
}

async function notifyTelegram(lead: Lead): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!token || !chatId) return;

    const lines = [
      "🆕 Новая заявка с сайта Нависерт",
      "",
      `👤 ${lead.name}`,
      `📞 ${lead.phone}`,
      lead.email ? `✉️ ${lead.email}` : null,
      lead.service ? `📋 ${lead.service}` : null,
      lead.message ? `💬 ${lead.message}` : null,
      `📍 Источник: ${lead.source}`,
      `🕐 ${formatLeadTelegramTime(lead)}`,
    ].filter(Boolean);

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines.join("\n"),
        }),
      }
    );

    const data = (await res.json()) as { ok?: boolean };
    if (!res.ok || !data.ok) return;
  } catch {
    return;
  }
}

function smtpAttempts(): { port: number; secure: boolean }[] {
  const configured = Number(process.env.SMTP_PORT || "465");
  const attempts: { port: number; secure: boolean }[] = [
    { port: configured, secure: configured === 465 },
  ];
  // AEZA и многие VPS блокируют 465/587, но пропускают 2525 (Mail.ru).
  if (configured !== 2525) {
    attempts.push({ port: 2525, secure: false });
  }
  return attempts;
}

async function notifyEmail(lead: Lead): Promise<void> {
  const host = process.env.SMTP_HOST?.trim() || "smtp.mail.ru";
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) return;

  const site = getSite();
  const from = process.env.SMTP_FROM?.trim() || user;
  const to = process.env.NOTIFY_EMAIL?.trim() || site.email;

  const mail: nodemailer.SendMailOptions = {
    from: `"${site.name}" <${from}>`,
    to,
    subject: `Заявка с сайта — ${lead.name}`,
    text: formatLeadText(lead),
  };

  if (lead.email && validateLeadEmail(lead.email)) {
    mail.replyTo = lead.email;
  }

  for (const { port, secure } of smtpAttempts()) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        tls: { minVersion: "TLSv1.2" },
      });
      await transporter.sendMail(mail);
      return;
    } catch {
      continue;
    }
  }
}

/** Уведомления в фоне — не блокируют ответ формы. Сбой канала не влияет на заявку. */
export function notifyNewLead(lead: Lead): void {
  void Promise.allSettled([notifyTelegram(lead), notifyEmail(lead)]);
}
