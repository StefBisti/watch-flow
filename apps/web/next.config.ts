import type { NextConfig } from "next";
import "./lib/env";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@watchflow/db"],
  cacheComponents: false,
  typedRoutes: true,
};

export default nextConfig;
