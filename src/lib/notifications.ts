import type { Lead } from "./types";

export async function notifyNewLead(lead: Lead): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

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

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "HTML",
      }),
    });
  } catch {
    // Не блокируем сохранение заявки при сбое уведомления
  }
}
