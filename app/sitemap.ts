import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
export default function sitemap(): MetadataRoute.Sitemap {
  // Only the public introduction belongs here. Never include private league URLs.
  return [{ url: `${SITE_URL}/` }];
}
