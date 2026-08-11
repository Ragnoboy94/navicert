import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { SocksClient } from "socks";

export type SmtpAttempt = {
  port: number;
  secure: boolean;
  requireTLS: boolean;
};

export function getOutreachSmtpProxy(): string | undefined {
  return (
    process.env.OUTREACH_SMTP_PROXY?.trim() ||
    process.env.OUTREACH_SOCKS_PROXY?.trim() ||
    undefined
  );
}

/** Yandex: 587 (STARTTLS), отдельно от заявок на mail.ru:2525 */
export function outreachSmtpAttempts(
  portOverride?: string | number | null
): SmtpAttempt[] {
  const configured = Number(
    portOverride ?? process.env.OUTREACH_SMTP_PORT ?? "587"
  );
  const attempts: SmtpAttempt[] = [];

  const add = (port: number) => {
    attempts.push({
      port,
      secure: port === 465,
      requireTLS: port === 587,
    });
  };

  add(Number.isFinite(configured) && configured > 0 ? configured : 587);
  if (configured !== 587) add(587);
  if (configured !== 465) add(465);

  const seen = new Set<number>();
  return attempts.filter((item) => {
    if (seen.has(item.port)) return false;
    seen.add(item.port);
    return true;
  });
}

function parseSocksProxy(raw: string): {
  host: string;
  port: number;
  type: 5;
  userId?: string;
  password?: string;
} {
  const url = new URL(raw.includes("://") ? raw : `socks5://${raw}`);
  const type = url.protocol.startsWith("socks4") ? 4 : 5;
  if (type !== 5) {
    throw new Error("Only SOCKS5 is supported for OUTREACH_SMTP_PROXY");
  }
  return {
    host: url.hostname,
    port: Number(url.port || "1080"),
    type: 5,
    ...(url.username
      ? {
          userId: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        }
      : {}),
  };
}

function socksGetSocket(proxyRaw: string) {
  const proxy = parseSocksProxy(proxyRaw);
  return (
    options: { host?: string; port?: number },
    callback: (err: Error | null, socketOptions?: { connection: unknown }) => void
  ) => {
    const host = options.host;
    const port = options.port;
    if (!host || !port) {
      callback(new Error("SMTP host/port missing"));
      return;
    }
    SocksClient.createConnection({
      proxy,
      command: "connect",
      destination: { host, port },
      timeout: 15_000,
    })
      .then((info) => {
        info.socket.setKeepAlive(true, 15_000);
        info.socket.setTimeout(0);
        callback(null, { connection: info.socket });
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)));
      });
  };
}

export function createOutreachTransporter(options: {
  host: string;
  user: string;
  pass: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
}) {
  const proxy = getOutreachSmtpProxy();
  const transport: SMTPTransport.Options = {
    host: options.host,
    port: options.port,
    secure: options.secure,
    requireTLS: options.requireTLS,
    auth: { user: options.user, pass: options.pass },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    tls: { minVersion: "TLSv1.2", servername: options.host },
    ...(proxy ? { getSocket: socksGetSocket(proxy) } : {}),
  };
  return nodemailer.createTransport(transport);
}

export function smtpErrorReason(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "smtp_timeout";
  }
  if (lower.includes("auth") || lower.includes("credentials")) {
    return "smtp_auth_failed";
  }
  return "smtp_send_failed";
}
