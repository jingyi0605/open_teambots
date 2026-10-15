import { DocArticle } from "@/components/docs/doc-article";
import { docsConfig, getDocPage } from "@/lib/docs";
import { pageMetadata } from "@/lib/page-metadata";

const page = getDocPage(docsConfig.home)!;

export const metadata = pageMetadata({
  title: `${page.title} | OpenTeam ${docsConfig.title}`,
  description: page.metaDescription,
  path: "/docs",
});

export default function DocsIndex() {
  return <DocArticle page={page} />;
}
