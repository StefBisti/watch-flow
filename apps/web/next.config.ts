import type { NextConfig } from "next";
import "./lib/env";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@watchflow/db"],
  cacheComponents: true,
  typedRoutes: true,
};

export default nextConfig;
