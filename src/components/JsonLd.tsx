import { getSite, getFaq, getReviews } from "@/lib/content";
import { buildOrganizationJsonLd, buildWebsiteJsonLd } from "@/lib/jsonld";

export function JsonLd() {
  const site = getSite();
  const faq = getFaq();
  const reviews = getReviews();

  const organization = buildOrganizationJsonLd(site, reviews);
  const website = buildWebsiteJsonLd(site);

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
