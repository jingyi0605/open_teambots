import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocBody } from "@/components/docs/doc-body";
import { InlineTableOfContents, TableOfContents } from "@/components/docs/table-of-contents";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { blogPosts, getBlogPost, readNext } from "@/lib/blog";
import { formatDate, isoTimestamp } from "@/lib/blog-dates";
import { pageMetadata } from "@/lib/page-metadata";
import { blogPostStructuredData, JsonLd } from "@/lib/structured-data";
import { BLOG_FEED } from "../feed";
import "../../landing.css";
import "../../monochrome.css";
import "../../docs/docs.css";
import "../blog.css";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  const metadata = pageMetadata({
    title: post.seoTitle,
    description: post.description,
    path: post.href,
    // The per-post card from ./opengraph-image.tsx; the lead screenshot stays in the structured data.
    image: { url: `${post.href}/opengraph-image`, alt: post.title, width: 1200, height: 630 },
    article: {
      publishedTime: isoTimestamp(post.date),
      modifiedTime: isoTimestamp(post.updated ?? post.date),
      authors: [post.author.url],
      section: post.category,
    },
  });
  return { ...metadata, alternates: { ...metadata.alternates, types: BLOG_FEED } };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();
  const sections = post.headings.filter((heading) => heading.level === 2);
  // Long posts get an "On this page" menu; comparisons open on their answer and table instead of a hero.
  const showContents = post.readingMinutes >= 7 && sections.length > 2;
  const showHero = post.image && post.category !== "Comparisons";
  const next = readNext(post.slug);

  return (
    <div className="landing ot-blog" id="top">
      <JsonLd data={blogPostStructuredData(post)} />
      <a href="#main" className="ot-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="ot-container blog-post-layout">
        <article className="blog-article">
          <header className="blog-post-header">
            <nav className="blog-breadcrumbs" aria-label="Breadcrumb">
              <Link href="/blog">Blog</Link>
              <span aria-hidden="true">/</span>
              <span>{post.category}</span>
            </nav>
            <h1>{post.title}</h1>
            <p className="blog-dek">{post.description}</p>
            <div className="blog-byline">
              <a href={post.author.url} rel="author">
                {post.author.name}
              </a>
              <span aria-hidden="true">·</span>
              <time dateTime={isoTimestamp(post.date)}>{formatDate(post.date)}</time>
              {post.updated && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Updated <time dateTime={isoTimestamp(post.updated)}>{formatDate(post.updated)}</time>
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{post.readingMinutes} min read</span>
            </div>
          </header>
          {showHero && (
            <figure className="blog-hero">
              <Image
                src={post.image!}
                alt={post.imageAlt!}
                width={post.imageWidth ?? 1600}
                height={post.imageHeight ?? 900}
                sizes="(max-width: 800px) 100vw, 760px"
                priority
              />
            </figure>
          )}
          {showContents && <InlineTableOfContents headings={sections} />}
          {/* HTML is compiled from checked-in Markdown, with raw HTML escaped. */}
          <DocBody html={post.html} className="docs-prose blog-prose" />
          <aside className="blog-cta" aria-label="Get OpenTeam">
            <div>
              <h2>Run your own AI team</h2>
              <p>
                OpenTeam is open source and self-hosted. Install the server with one command, then
                connect the desktop app.
              </p>
            </div>
            <div className="blog-cta-actions">
              <a className="ot-button" href="/download">
                Install OpenTeam <ArrowUpRight size={15} />
              </a>
              <Link className="blog-cta-secondary" href="/docs/getting-started/quickstart">
                Read the quickstart
              </Link>
            </div>
          </aside>
        </article>
        {showContents && (
          <aside className="docs-toc blog-toc">
            <TableOfContents headings={sections} />
          </aside>
        )}
      </main>
      {next.length > 0 && (
        <section className="ot-container blog-read-next" aria-labelledby="read-next">
          <h2 id="read-next">Read next</h2>
          <ul>
            {next.map((entry) => (
              <li key={entry.slug}>
                <Link href={entry.href}>
                  <span className="blog-card-meta">
                    {entry.category} · <time dateTime={isoTimestamp(entry.date)}>{formatDate(entry.date)}</time>
                  </span>
                  <span className="blog-card-title">{entry.title}</span>
                  <span className="blog-card-description">{entry.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <SiteFooter />
    </div>
  );
}
