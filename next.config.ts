import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: false,
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/build/**/*", "./data/rep-bank/**/*", "./data/aliases.json"],
  },
};

export default nextConfig;
