import type { OutreachCategory } from "./types";

export const OUTREACH_CATEGORIES: OutreachCategory[] = [
  "expiring",
  "expiring_certificates",
  "new_registrations",
];

export function parseOutreachCategory(
  raw: string | null | undefined
): OutreachCategory {
  if (raw === "expiring_certificates") return "expiring_certificates";
  if (raw === "new_registrations") return "new_registrations";
  return "expiring";
}

export function isFsaOutreachCategory(category: OutreachCategory): boolean {
  return category === "expiring" || category === "expiring_certificates";
}

export function isNewRegistrationsCategory(
  category: OutreachCategory
): boolean {
  return category === "new_registrations";
}

/** @deprecated use isNewRegistrationsCategory */
export function isCheckoOutreachCategory(category: OutreachCategory): boolean {
  return isNewRegistrationsCategory(category);
}
