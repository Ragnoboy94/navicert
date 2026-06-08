import { cookies } from "next/headers";

const COOKIE_NAME = "navicert_admin";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

type AdminCookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
};

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "navicert2025";
}

/** Secure only over HTTPS (or when COOKIE_SECURE=true). HTTP + secure cookie = login loop. */
export function shouldUseSecureCookies(request?: Request): boolean {
  const env = process.env.COOKIE_SECURE;
  if (env === "true") return true;
  if (env === "false") return false;

  if (!request) return false;

  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0].trim().toLowerCase() === "https";
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function getAdminCookieOptions(
  request: Request,
  overrides: Partial<AdminCookieOptions> = {}
): AdminCookieOptions {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(request),
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
    ...overrides,
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token === getAdminPassword();
}

export { COOKIE_NAME };
