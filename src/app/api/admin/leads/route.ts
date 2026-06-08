import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isAuthenticated } from "@/lib/auth";
import type { Lead } from "@/lib/types";

const leadsPath = path.join(process.cwd(), "data", "leads.json");

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!fs.existsSync(leadsPath)) {
    return NextResponse.json([]);
  }

  const leads: Lead[] = JSON.parse(fs.readFileSync(leadsPath, "utf-8"));
  return NextResponse.json(leads.reverse());
}
