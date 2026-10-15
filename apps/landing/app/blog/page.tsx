import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { blogPosts } from "@/lib/blog";
import { formatDate, isoTimestamp } from "@/lib/blog-dates";
import { pageMetadata } from "@/lib/page-metadata";
import { blogIndexStructuredData, JsonLd } from "@/lib/structured-data";
import { BLOG_FEED } from "./feed";
import "../landing.css";
import "../monochrome.css";
import "./blog.css";

const metadataBase = pageMetadata({
  title: "Blog | OpenTeam, self-hosted AI agents",
  description:
    "Comparisons, guides, and engineering notes from the team building OpenTeam, an open-source, self-hosted team of AI agents.",
  path: "/blog",
});

export const metadata = { ...metadataBase, alternates: { ...metadataBase.alternates, types: BLOG_FEED } };

export default function BlogIndex() {
  return (
    <div className="landing ot-blog" id="top">
      <JsonLd data={blogIndexStructuredData(blogPosts)} />
      <a href="#main" className="ot-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="ot-container blog-index">
        <header className="blog-index-header">
          <h1>Blog</h1>
          <p>
            Comparisons, guides, and engineering notes from building OpenTeam, an open-source team of
            AI agents that runs on your own hardware.
          </p>
        </header>
        <ol className="blog-list">
          {blogPosts.map((post) => (
            <li key={post.slug}>
              <article>
                <div className="blog-card-meta">
                  <time dateTime={isoTimestamp(post.date)}>{formatDate(post.date)}</time>
                  <span aria-hidden="true">·</span>
                  <span>{post.category}</span>
                </div>
                <h2>
                  <Link href={post.href}>{post.title}</Link>
                </h2>
                <p>{post.description}</p>
              </article>
            </li>
          ))}
        </ol>
        <p className="blog-feed-link">
          <a href="/blog/rss.xml">RSS</a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
