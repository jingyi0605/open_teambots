import type { Metadata } from "next";

export const SITE_URL = "https://openteam.so";
// Search results show the title and description, so both lead with the terms people search for.
export const SITE_TITLE = "OpenTeam: Run your own team of self-hosted AI agents";
export const SITE_DESCRIPTION =
  "Open-source AI agents that run on your hardware. Each gets its own computer and browser, works in your apps, remembers how you work, and delegates to teammates.";
export const GITHUB_URL = "https://github.com/raghavpillai/openteam";

// Change the image URL when the artwork changes so share crawlers fetch it again.
const SOCIAL_IMAGE = {
  url: `${SITE_URL}/social/openteam-2026-09-13.png`,
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "OpenTeam — Run your own AI team. Digital workers on your compute. Open source and self-hosted, with the teal 2D OpenTeam bot.",
};

export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = new URL(path, SITE_URL).toString();
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      siteName: "OpenTeam",
      locale: "en_US",
      images: [{ ...SOCIAL_IMAGE, secureUrl: SOCIAL_IMAGE.url }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: SOCIAL_IMAGE.url, alt: SOCIAL_IMAGE.alt }],
    },
  };
}
