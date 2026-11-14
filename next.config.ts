import type { NextConfig } from "next";

const serverData = ["./data/build/**/*", "./data/rep-bank/**/*", "./data/aliases.json", "./data/aliases.i18n.json", "./public/data/occ/**/*", "./src/content/samples/**/*"];

const nextConfig: NextConfig = {
  cacheComponents: false,
  outputFileTracingIncludes: {
    "/api/**/*": serverData,
    "/x/[id]": serverData,
    "/jobs/[slug]": serverData,
    "/jobs/**/*": serverData,
    "/method": serverData,
    "/sitemap.xml": serverData,
  },
};

export default nextConfig;
