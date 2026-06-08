import { cookies } from "next/headers";

const COOKIE_NAME = "navicert_admin";

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "navicert2025";
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token === getAdminPassword();
}

export { COOKIE_NAME };
