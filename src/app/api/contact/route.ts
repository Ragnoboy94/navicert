import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSite } from "@/lib/content";
import { notifyNewLead } from "@/lib/notifications";
import {
  normalizeRuPhone,
  validateLeadEmail,
  validateLeadName,
} from "@/lib/phone";
import type { Lead } from "@/lib/types";

const leadsPath = path.join(process.cwd(), "data", "leads.json");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, message, service, source } = body;

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
