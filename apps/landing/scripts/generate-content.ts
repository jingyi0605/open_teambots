import { generateBlog } from "./build-blog";
import { generateDocs } from "./build-docs";

/** Builds the blog first so `llms.txt` can list its posts after the docs. */
export function generateContent() {
  const blog = generateBlog();
  const docs = generateDocs(blog.posts.map(({ title, href, description }) => ({ title, href, description })));
  return { blog, docs };
}
