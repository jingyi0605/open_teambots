import type { BlogPost } from "./blog-types";
import { isoTimestamp } from "./blog-dates";
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
  // Desktop builds exist for macOS (Apple silicon) and Linux; the iPhone app is in beta.
  operatingSystem: "macOS, Linux, iOS",
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

export const downloadStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    organization,
    {
      "@type": "WebPage",
      "@id": `${SITE_URL}/download#page`,
      name: "Download OpenTeam",
      url: `${SITE_URL}/download`,
      about: { "@id": SOFTWARE_ID },
      isPartOf: { "@id": WEBSITE_ID },
      inLanguage: "en",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "OpenTeam", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Download", item: `${SITE_URL}/download` },
      ],
    },
  ],
};

export function blogIndexStructuredData(posts: BlogPost[]) {
  const url = `${SITE_URL}/blog`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "Blog",
        "@id": `${url}#blog`,
        name: "OpenTeam blog",
        url,
        inLanguage: "en",
        publisher: { "@id": ORGANIZATION_ID },
        blogPost: posts.map((post) => ({
          "@type": "BlogPosting",
          headline: post.title,
          url: new URL(post.href, SITE_URL).toString(),
          datePublished: isoTimestamp(post.date),
        })),
      },
    ],
  };
}

export function blogPostStructuredData(post: BlogPost) {
  const url = new URL(post.href, SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "BlogPosting",
        "@id": `${url}#article`,
        headline: post.title,
        description: post.description,
        url,
        mainEntityOfPage: url,
        // The generated social card first, then the post's lead screenshot.
        image: [`${url}/opengraph-image`, ...(post.image ? [new URL(post.image, SITE_URL).toString()] : [])],
        wordCount: post.wordCount,
        datePublished: isoTimestamp(post.date),
        dateModified: isoTimestamp(post.updated ?? post.date),
        author: { "@type": "Person", name: post.author.name, url: post.author.url },
        articleSection: post.category,
        inLanguage: "en",
        isPartOf: { "@id": `${SITE_URL}/blog#blog` },
        publisher: { "@id": ORGANIZATION_ID },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "OpenTeam", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
          { "@type": "ListItem", position: 3, name: post.title, item: url },
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
