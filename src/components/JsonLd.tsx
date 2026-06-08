import { getSite, getFaq } from "@/lib/content";

export function JsonLd() {
  const site = getSite();
  const faq = getFaq();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://navicert.pro";

  const organization = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: site.name,
    description: site.description,
    url: baseUrl,
    telephone: site.phoneRaw,
    email: site.email,
    image: site.ogImage ? `${baseUrl}${site.ogImage}` : undefined,
    areaServed: { "@type": "Country", name: "Россия" },
    priceRange: "₽₽",
    address: {
      "@type": "PostalAddress",
      addressCountry: "RU",
    },
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: baseUrl,
    description: site.seo.description,
    inLanguage: "ru-RU",
  };

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage) }}
      />
    </>
  );
}
