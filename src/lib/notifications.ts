import nodemailer from "nodemailer";
import type { Lead } from "./types";
import { getSite } from "./content";

function formatLeadText(lead: Lead): string {
  return [
    "Новая заявка с сайта Нависерт",
    "",
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    lead.email ? `Email клиента: ${lead.email}` : null,
    lead.service ? `Услуга: ${lead.service}` : null,
    lead.message ? `Сообщение: ${lead.message}` : null,
    `Источник: ${lead.source}`,
    `Время: ${new Date(lead.createdAt).toLocaleString("ru-RU")}`,
  ]
    .filter(Boolean)
    .join("\n");
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
      `🕐 ${new Date(lead.createdAt).toLocaleString("ru-RU")}`,
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

async function notifyEmail(lead: Lead): Promise<void> {
  try {
    const host = process.env.SMTP_HOST || "smtp.mail.ru";
    const port = Number(process.env.SMTP_PORT || "465");
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) return;

    const site = getSite();
    const from = process.env.SMTP_FROM || user;
    const to = process.env.NOTIFY_EMAIL || site.email;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: `"${site.name}" <${from}>`,
      to,
      replyTo: lead.email || undefined,
      subject: `Заявка с сайта — ${lead.name}`,
      text: formatLeadText(lead),
    });
  } catch {
    return;
  }
}

/** Уведомления в фоне — не блокируют ответ формы. Сбой канала не влияет на заявку. */
export function notifyNewLead(lead: Lead): void {
  void Promise.allSettled([notifyTelegram(lead), notifyEmail(lead)]);
}
