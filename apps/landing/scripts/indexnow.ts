// Tells Bing and other IndexNow engines about every URL in the live sitemap.
// Run after a deploy: bun scripts/indexnow.ts [url ...]
import { SITE_URL } from "../lib/page-metadata";

// Public by design: engines fetch it from the site root to verify ownership.
const KEY = "aca90ccb03ef32f7076bf53b527caa86";

const host = new URL(SITE_URL).host;
const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [...(await (await fetch(`${SITE_URL}/sitemap.xml`)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (!urls.length) throw new Error("No URLs to submit");

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key: KEY, keyLocation: `${SITE_URL}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${response.status} ${response.statusText} for ${urls.length} URLs`);
if (!response.ok && response.status !== 202) process.exit(1);
