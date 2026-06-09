import type { Review, SiteConfig } from "./types";

export function siteBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://navicert.pro";
}

export function socialSameAs(social: SiteConfig["social"]): string[] {
  return [social.telegram, social.whatsapp, social.max].filter((url) =>
    url?.trim()
  );
}

/** Город в schema — только если есть реальный офис приёма. Иначе только страна. */
export function buildPostalAddress(site: SiteConfig) {
  const country = site.address?.country?.trim() || "RU";
  const locality = site.address?.locality?.trim();
  const region = site.address?.region?.trim();

  if (locality) {
    return {
      "@type": "PostalAddress" as const,
      addressLocality: locality,
      ...(region && { addressRegion: region }),
      addressCountry: country,
    };
  }

  return {
    "@type": "PostalAddress" as const,
    addressCountry: country,
  };
}

export function buildOrganizationJsonLd(site: SiteConfig, reviews: Review[]) {
  const baseUrl = siteBaseUrl();

  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${baseUrl}/#organization`,
    name: site.name,
    description: site.description,
    url: baseUrl,
    telephone: site.phoneRaw,
    email: site.email,
    image: site.ogImage ? `${baseUrl}${site.ogImage}` : undefined,
    areaServed: { "@type": "Country", name: "Россия" },
    priceRange: "₽₽",
    sameAs: socialSameAs(site.social),
    address: buildPostalAddress(site),
    ...(reviews.length > 0 && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "5",
        bestRating: "5",
        reviewCount: String(reviews.length),
      },
      review: reviews.map((item) => ({
        "@type": "Review",
        author: { "@type": "Person", name: item.author },
        reviewBody: item.text,
        reviewRating: {
          "@type": "Rating",
          ratingValue: "5",
          bestRating: "5",
        },
      })),
    }),
  };
}

export function buildWebsiteJsonLd(site: SiteConfig) {
  const baseUrl = siteBaseUrl();

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}/#website`,
    name: site.name,
    url: baseUrl,
    description: site.seo.description,
    inLanguage: "ru-RU",
    publisher: { "@id": `${baseUrl}/#organization` },
  };
}
