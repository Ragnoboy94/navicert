const PHONE_DIGITS_LEN = 11;

export function phoneDigits(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    digits = "7" + digits;
  }
  if (digits && !digits.startsWith("7")) {
    digits = "7" + digits;
  }
  return digits.slice(0, PHONE_DIGITS_LEN);
}

export function formatRuPhone(digits: string): string {
  const d = phoneDigits(digits);
  if (d.length <= 1) return "";

  const rest = d.slice(1);
  let out = "+7";

  if (rest.length > 0) out += ` (${rest.slice(0, 3)}`;
  if (rest.length >= 3) out += `) ${rest.slice(3, 6)}`;
  if (rest.length >= 6) out += `-${rest.slice(6, 8)}`;
  if (rest.length >= 8) out += `-${rest.slice(8, 10)}`;

  return out;
}

export function normalizeRuPhone(value: string): string | null {
  const d = phoneDigits(value);
  if (d.length !== PHONE_DIGITS_LEN || !d.startsWith("7")) return null;
  return `+${d}`;
}

export function isValidRuPhone(value: string): boolean {
  return normalizeRuPhone(value) !== null;
}

export function validateLeadName(value: string): boolean {
  const name = value.trim();
  if (name.length < 2 || name.length > 80) return false;
  return /[\p{L}]/u.test(name);
}

export function validateLeadEmail(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
