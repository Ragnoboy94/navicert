import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { Chaport } from "@/components/Chaport";
import { YandexMetrika } from "@/components/YandexMetrika";
import { SiteMapShell } from "@/components/SiteMapShell";
import { getSite, getPartners } from "@/lib/content";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = getSite();
  const partners = getPartners();

  return (
    <>
      <YandexMetrika />
      <Chaport />
      <JsonLd />
      <Header site={site} />
      <main>
        <SiteMapShell>{children}</SiteMapShell>
      </main>
      <Footer site={site} partners={partners} />
    </>
  );
}
