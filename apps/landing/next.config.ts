import type { NextConfig } from "next";
import { generateContent } from "./scripts/generate-content";

generateContent();

const nextConfig: NextConfig = {
  // One canonical host, so search engines don't index www as a duplicate site.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.openteam.so" }],
        destination: "https://openteam.so/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
