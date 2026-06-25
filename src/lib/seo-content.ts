const translit: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function slugify(text: string): string {
  const lower = text.trim().toLowerCase();
  let result = "";

  for (const char of lower) {
    if (translit[char] !== undefined) {
      result += translit[char];
    } else if (/[a-z0-9]/.test(char)) {
      result += char;
    } else if (char === " " || char === "-" || char === "_") {
      result += "-";
    }
  }

  return result
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function uniqueSlug(
  base: string,
  existing: string[],
  fallback = "kategoriya"
): string {
  let slug = slugify(base) || fallback;
  if (!existing.includes(slug)) return slug;

  let n = 2;
  while (existing.includes(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

function trimDescription(text: string, max = 160): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export function buildCategorySeo(title: string, description: string) {
  const name = title.trim();
  const desc = description.trim();

  return {
    title: name ? `${name} — сертификация и оформление документов` : "",
    description: desc
      ? trimDescription(desc)
      : name
        ? `Оформление сертификатов и деклараций: ${name}. Бесплатная консультация и расчёт стоимости.`
        : "",
  };
}

export function buildServiceSeo(
  title: string,
  description: string,
  priceFrom = ""
) {
  const name = title.trim();
  const desc = description.trim();
  const price = priceFrom.trim();

  const seoTitle = name
    ? price
      ? `${name} — оформление — ${price}`
      : `${name} — оформление под ключ`
    : "";

  const seoDescription = desc
    ? price
      ? trimDescription(`Стоимость ${price}. ${desc}`)
      : trimDescription(desc)
    : name
      ? price
        ? `Стоимость ${price}. Оформление: ${name}. Бесплатная консультация.`
        : `Оформление: ${name}. Бесплатная консультация и расчёт стоимости.`
      : "";

  return { title: seoTitle, description: seoDescription };
}
