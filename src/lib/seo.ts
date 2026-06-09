/** Извлекает число из строки «от 15 000 ₽» для schema.org */
export function parsePriceRub(priceFrom: string): number | undefined {
  const digits = priceFrom.replace(/\D/g, "");
  if (!digits) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) ? value : undefined;
}

export function withCostInDescription(description: string, priceFrom?: string): string {
  if (!priceFrom) return description;
  if (description.toLowerCase().includes("стоимость")) return description;
  return `Стоимость ${priceFrom.toLowerCase()}. ${description}`;
}
