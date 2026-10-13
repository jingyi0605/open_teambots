import type { DocPage } from "./docs-types";
import { GITHUB_URL, SITE_DESCRIPTION, SITE_URL } from "./page-metadata";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;

const organization = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: "OpenTeam",
  url: SITE_URL,
  logo: { "@type": "ImageObject", url: `${SITE_URL}/openteam-app-icon.png` },
  sameAs: [GITHUB_URL],
};

const website = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: "OpenTeam",
  url: SITE_URL,
  inLanguage: "en",
  publisher: { "@id": ORGANIZATION_ID },
};

// Names the product category and its facts so search and answer engines can tell
// OpenTeam apart from similarly named companies.
const software = {
  "@type": "SoftwareApplication",
  "@id": SOFTWARE_ID,
  name: "OpenTeam",
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  downloadUrl: `${SITE_URL}/download`,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Self-hosted AI agents",
  operatingSystem: "macOS, Windows, Linux, iOS",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://www.gnu.org/licenses/gpl-3.0.html",
  image: `${SITE_URL}/social/openteam-2026-09-13.png`,
  sameAs: [GITHUB_URL],
  publisher: { "@id": ORGANIZATION_ID },
};

export const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [organization, website, software],
};

export function docStructuredData(page: DocPage) {
  const url = new URL(page.href, SITE_URL).toString();
  const docsUrl = `${SITE_URL}/docs`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline: page.title,
        description: page.description,
        url,
        mainEntityOfPage: url,
        ...(page.updated ? { dateModified: page.updated } : {}),
        inLanguage: "en",
        articleSection: page.group,
        about: { "@type": "SoftwareApplication", "@id": SOFTWARE_ID, name: "OpenTeam" },
        isPartOf: { "@id": WEBSITE_ID },
        publisher: { "@id": ORGANIZATION_ID },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "OpenTeam", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Docs", item: docsUrl },
          ...(url === docsUrl
            ? []
            : [{ "@type": "ListItem", position: 3, name: page.title, item: url }]),
        ],
      },
    ],
  };
}

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // Escaping "<" keeps page text from closing the script element early.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
