const OFFICE_TZ = "Europe/Kaliningrad";

const fmt: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function formatInTz(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("ru-RU", { ...fmt, timeZone });
}

/** Строки времени заявки для уведомлений. */
export function formatLeadTimeLines(
  createdAt: string,
  clientTimezone?: string
): string[] {
  const lines = [`Калининград: ${formatInTz(createdAt, OFFICE_TZ)}`];

  if (clientTimezone) {
    try {
      lines.push(
        `У клиента (${clientTimezone}): ${formatInTz(createdAt, clientTimezone)}`
      );
    } catch {
      lines.push(`Часовой пояс клиента: ${clientTimezone}`);
    }
  }

  return lines;
}
