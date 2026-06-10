import type { Metadata } from "next";
import { Onest } from "next/font/google";
import "./globals.css";
import { getSite } from "@/lib/content";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
});

const site = getSite();

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://navicert.pro"
  ),
  title: {
    default: site.seo.title,
    template: `%s | ${site.name}`,
  },
  description: site.seo.description,
  keywords: site.seo.keywords,
  openGraph: {
    title: site.seo.title,
    description: site.seo.description,
    url: "/",
    siteName: site.name,
    locale: "ru_RU",
    type: "website",
    images: site.ogImage
      ? [{ url: site.ogImage, width: 1200, height: 630, alt: site.name }]
      : undefined,
  },
  twitter: {
    card: "summary_large_image",
    title: site.seo.title,
    description: site.seo.description,
    images: site.ogImage ? [site.ogImage] : undefined,
  },
  robots: { index: true, follow: true },
  verification: {
    google: "oNSfLJdFqi5LWHaKS2gsg0qha0TeVlSZwrmYdiIPFWY",
    yandex: "b3695aa9e85374bf",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${onest.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
