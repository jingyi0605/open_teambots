import data from "../.generated/blog.json";
import type { BlogData } from "./blog-types";

export const { posts: blogPosts } = data as BlogData;

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

/** Posts listed under "Read next": the author's picks first, then the newest others. */
export function readNext(slug: string, count = 3) {
  const post = getBlogPost(slug);
  const picks = (post?.related ?? []).map(getBlogPost).filter((entry) => entry !== undefined);
  const rest = blogPosts.filter((entry) => entry.slug !== slug && !picks.includes(entry));
  return [...picks, ...rest].slice(0, count);
}
