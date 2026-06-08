import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSite } from "@/lib/content";
import { notifyNewLead } from "@/lib/notifications";
import type { Lead } from "@/lib/types";

const leadsPath = path.join(process.cwd(), "data", "leads.json");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, message, service, source } = body;

    if (!name || !phone) {
      return NextResponse.json(
        { error: "Укажите имя и телефон" },
        { status: 400 }
      );
    }

    const lead: Lead = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: email ? String(email).trim() : undefined,
      message: message ? String(message).trim() : undefined,
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
      await notifyNewLead(lead);
    }

    return NextResponse.json({ success: true, id: lead.id });
  } catch {
    return NextResponse.json(
      { error: "Не удалось сохранить заявку" },
      { status: 500 }
    );
  }
}
