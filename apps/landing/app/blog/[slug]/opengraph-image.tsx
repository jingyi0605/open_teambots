import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { blogPosts, getBlogPost } from "@/lib/blog";
import { formatDate } from "@/lib/blog-dates";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "OpenTeam blog post";

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

// A distinct card per post, so shared links and previews don't all show the same screenshot.
export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  const icon = `data:image/png;base64,${readFileSync(path.join(process.cwd(), "public/openteam-app-icon.png"), "base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#ffffff",
          color: "#111111",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img src={icon} width={56} height={56} alt="" />
          <div style={{ fontSize: 36, letterSpacing: -1 }}>OpenTeam</div>
          <div style={{ marginLeft: "auto", fontSize: 24, color: "#6b6b6b" }}>
            {post ? `${post.category} · ${formatDate(post.date)}` : "Blog"}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: (post?.title.length ?? 0) > 60 ? 62 : 70, lineHeight: 1.08, letterSpacing: -2.4 }}>
          {post?.title ?? "OpenTeam blog"}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#6b6b6b", borderTop: "1px solid #e5e5e5", paddingTop: 28 }}>
          <div>Open-source, self-hosted AI agents</div>
          <div>openteam.so/blog</div>
        </div>
      </div>
    ),
    size
  );
}
