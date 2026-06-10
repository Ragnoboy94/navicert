import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getCategories, getCategory, getSite } from "@/lib/content";
import { ContactForm } from "@/components/ContactForm";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export function generateStaticParams() {
  return getCategories().map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) return {};

  return {
    title: category.seo.title,
    description: category.seo.description,
    alternates: { canonical: `/produkciya/${slug}` },
    openGraph: {
      title: category.seo.title,
      description: category.seo.description,
      url: `/produkciya/${slug}`,
      type: "article",
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = getCategory(slug);
  if (!category) notFound();

  const site = getSite();
  const categoryJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Сертификация: ${category.title}`,
    description: category.description,
    provider: { "@type": "Organization", name: site.name },
    areaServed: { "@type": "Country", name: "Россия" },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(categoryJsonLd) }}
      />
    <div>
      <div className="surface-muted section-compact">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <Breadcrumbs
            items={[
              { label: "Главная", href: "/" },
              { label: "Продукция", href: "/produkciya" },
              { label: category.title },
            ]}
          />
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Сертификация: {category.title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            {category.description}
          </p>
        </div>
      </div>

      <div className="surface-white section container-page max-w-4xl">
        <h2 className="text-xl font-bold">Необходимые документы</h2>
        <ul className="mt-6 space-y-3">
          {category.documents.map((doc) => (
            <li
              key={doc}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <FileText className="h-5 w-5 text-primary" />
              <span>{doc}</span>
            </li>
          ))}
        </ul>

        <div className="mt-12 rounded-2xl border border-border bg-card p-8">
          <h2 className="text-xl font-bold">Бесплатная консультация</h2>
          <p className="mt-2 text-sm text-muted">
            Определим точный перечень документов для вашей продукции.
          </p>
          <div className="mt-6">
            <ContactForm
              source={`category:${slug}`}
              service={category.title}
            />
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
