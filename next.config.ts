import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["undici"],
  images: {
    unoptimized: process.env.NODE_ENV === "production",
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.ru.tuna.am",
    "*.tuna.am",
  ],
  async redirects() {
    return [
      { source: "/stati", destination: "/blog", permanent: true },
      { source: "/stati/:slug", destination: "/blog/:slug", permanent: true },
    ];
  },
};

export default nextConfig;
