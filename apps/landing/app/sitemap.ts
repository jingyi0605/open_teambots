import type { MetadataRoute } from "next";
import { docPages } from "@/lib/docs";
import { SITE_URL } from "@/lib/page-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/download`, changeFrequency: "weekly", priority: 0.9 },
    ...docPages.map((page) => ({
      url: new URL(page.href, SITE_URL).toString(),
      ...(page.updated ? { lastModified: page.updated } : {}),
      changeFrequency: "monthly" as const,
      priority: page.href === "/docs" ? 0.8 : 0.6,
    })),
  ];
}
