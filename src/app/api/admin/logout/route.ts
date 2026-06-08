import { NextResponse } from "next/server";
import { COOKIE_NAME, getAdminCookieOptions } from "@/lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(
    COOKIE_NAME,
    "",
    getAdminCookieOptions(request, { maxAge: 0 })
  );
  return response;
}
