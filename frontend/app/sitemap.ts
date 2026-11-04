import type { MetadataRoute } from "next";
import { navLinks, site } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return navLinks.map((l) => ({
    url: `${site.url}${l.href === "/" ? "" : l.href}`,
    changeFrequency: l.href === "/events" ? "weekly" : "monthly",
    priority: l.href === "/" ? 1 : 0.8,
  }));
}
