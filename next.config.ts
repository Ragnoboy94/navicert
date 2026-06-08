import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // В dev картинки и так без агрессивного кропа; на проде отключаем /_next/image
  images: {
    unoptimized: process.env.NODE_ENV === "production",
  },
  allowedDevOrigins: ["l4xkq4-92-101-127-10.ru.tuna.am"],
};

export default nextConfig;
