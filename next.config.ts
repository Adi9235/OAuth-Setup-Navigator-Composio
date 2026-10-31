import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only libraries: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["pg", "jsdom", "@mozilla/readability"],
};

export default nextConfig;
