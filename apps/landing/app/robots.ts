import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/page-metadata";

// Search and AI crawlers are all welcome; only the JSON and download endpoints are skipped.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
