import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Админ-панель",
  robots: { index: false, follow: false },
  manifest: "/admin-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Нависерт Чат",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/images/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e40af",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#eef2f8]">{children}</div>
  );
}
