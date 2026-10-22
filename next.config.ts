import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // playwright-core spawns a real browser; keep it out of the server bundle.
  serverExternalPackages: ["playwright-core"],
  // The preview iframe and the export renderer may open the dev server via 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // The dev indicator badge would otherwise be captured inside /preview frames during export.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
