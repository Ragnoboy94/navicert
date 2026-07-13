import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["undici"],
  images: {
    unoptimized: process.env.NODE_ENV === "production",
  },
  allowedDevOrigins: ["l4xkq4-92-101-127-10.ru.tuna.am"],
  async redirects() {
    return [
      { source: "/stati", destination: "/blog", permanent: true },
      { source: "/stati/:slug", destination: "/blog/:slug", permanent: true },
    ];
  },
};

export default nextConfig;
