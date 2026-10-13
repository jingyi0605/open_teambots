export const BLOG_CATEGORIES = ["Announcements", "Comparisons", "Guides", "Engineering"] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export type BlogAuthor = { name: string; url: string };

export type BlogPost = {
  slug: string;
  href: string;
  /** The visible headline (H1). */
  title: string;
  /** The search-result title, when it should differ from the headline. */
  seoTitle: string;
  description: string;
  /** YYYY-MM-DD */
  date: string;
  updated?: string;
  category: BlogCategory;
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  related: string[];
  author: BlogAuthor;
  markdown: string;
  html: string;
  headings: { id: string; title: string; level: number }[];
  readingMinutes: number;
  wordCount: number;
};

export type BlogData = { posts: BlogPost[] };
