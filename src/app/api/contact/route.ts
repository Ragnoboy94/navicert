import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSite } from "@/lib/content";
import {
  getClientIp,
  isHoneypotTriggered,
  validateFormTiming,
} from "@/lib/contactGuard";
import { notifyNewLead } from "@/lib/notifications";
import {
  normalizeRuPhone,
  validateLeadEmail,
  validateLeadName,
} from "@/lib/phone";
import { checkRateLimit } from "@/lib/rateLimit";
import type { Lead } from "@/lib/types";

const leadsPath = path.join(process.cwd(), "data", "leads.json");

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function fakeSuccess() {
  return NextResponse.json({ success: true, id: "accepted" });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      phone,
      email,
      message,
      service,
      source,
      consent,
      clientTimezone,
      company,
      formOpenedAt,
    } = body;

    if (isHoneypotTriggered(company)) {
      return fakeSuccess();
    }

    const clientIp = getClientIp(request);
    if (
      !checkRateLimit(
        `contact:${clientIp}`,
        RATE_LIMIT_MAX,
        RATE_LIMIT_WINDOW_MS
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Слишком много заявок с вашего подключения. Попробуйте позже или позвоните нам.",
        },
        { status: 429 }
      );
    }

    const timing = validateFormTiming(formOpenedAt);
    if (timing === "invalid") {
      return fakeSuccess();
    }
    if (timing === "too_fast") {
      return NextResponse.json(
        { error: "Подождите пару секунд и отправьте форму ещё раз" },
        { status: 400 }
      );
    }

    if (!consent) {
      return NextResponse.json(
        { error: "Необходимо принять политику конфиденциальности" },
        { status: 400 }
      );
    }

    const trimmedName = String(name || "").trim();
    const normalizedPhone = normalizeRuPhone(String(phone || ""));

    if (!validateLeadName(trimmedName)) {
      return NextResponse.json(
        { error: "Укажите корректное имя" },
        { status: 400 }
      );
    }

    if (!normalizedPhone) {
      return NextResponse.json(
        { error: "Укажите корректный номер телефона" },
        { status: 400 }
      );
    }

    const trimmedEmail = email ? String(email).trim() : undefined;
    if (!validateLeadEmail(trimmedEmail)) {
      return NextResponse.json(
        { error: "Укажите корректный e-mail" },
        { status: 400 }
      );
    }

    const lead: Lead = {
      id: crypto.randomUUID(),
      name: trimmedName,
      phone: normalizedPhone,
      email: trimmedEmail,
      message: message ? String(message).trim().slice(0, 2000) : undefined,
      service: service ? String(service).trim() : undefined,
      source: source ? String(source) : "website",
      createdAt: new Date().toISOString(),
      clientTimezone: clientTimezone
        ? String(clientTimezone).trim().slice(0, 64)
        : undefined,
    };

    const dataDir = path.dirname(leadsPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    let leads: Lead[] = [];
    if (fs.existsSync(leadsPath)) {
      leads = JSON.parse(fs.readFileSync(leadsPath, "utf-8"));
    }
    leads.push(lead);
    fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2) + "\n");

    const site = getSite();
    if (site.notifications?.telegramEnabled !== false) {
      notifyNewLead(lead);
    }

    return NextResponse.json({ success: true, id: lead.id });
  } catch {
    return NextResponse.json(
      { error: "Не удалось сохранить заявку" },
      { status: 500 }
    );
  }
}
