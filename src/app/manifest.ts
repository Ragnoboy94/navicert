import type { MetadataRoute } from "next";
import { getSite } from "@/lib/content";

export default function manifest(): MetadataRoute.Manifest {
  const site = getSite();

  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1e40af",
    lang: "ru",
  };
}
