import { blogPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/page-metadata";

export const dynamic = "force-static";

function xml(value: string) {
  return value.replace(/[<>&'"]/g, (character) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!
  );
}

/** Feed readers render the HTML elsewhere, so site paths become absolute and optimizer sources are dropped. */
function absolute(html: string) {
  return html.replace(/ (srcset|sizes)="[^"]*"/g, "").replace(/(src|href)="\/(?!\/)/g, `$1="${SITE_URL}/`);
}

export function GET() {
  const items = blogPosts.map((post) => {
    const url = `${SITE_URL}${post.href}`;
    const body = absolute(post.html).replaceAll("]]>", "]]]]><![CDATA[>");
    return `    <item>
      <title>${xml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(`${post.date}T12:00:00Z`).toUTCString()}</pubDate>
      <category>${xml(post.category)}</category>
      <description>${xml(post.description)}</description>
      <content:encoded><![CDATA[${body}]]></content:encoded>
    </item>`;
  });
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>OpenTeam blog</title>
    <link>${SITE_URL}/blog</link>
    <description>Comparisons, guides, and engineering notes from the team building OpenTeam.</description>
    <language>en</language>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
${blogPosts[0] ? `    <lastBuildDate>${new Date(`${blogPosts[0].updated ?? blogPosts[0].date}T12:00:00Z`).toUTCString()}</lastBuildDate>\n` : ""}${items.join("\n")}
  </channel>
</rss>
`;
  return new Response(feed, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
