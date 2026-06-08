import { NextResponse } from "next/server";
import { COOKIE_NAME, getAdminCookieOptions, getAdminPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = await request.json();

  if (password !== getAdminPassword()) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, password, getAdminCookieOptions(request));

  return response;
}
