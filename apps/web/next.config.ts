import type { NextConfig } from "next";
import "./lib/env";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@watchflow/db"],
  serverExternalPackages: ["bullmq"],
  cacheComponents: false,
  typedRoutes: true,
};

export default nextConfig;
