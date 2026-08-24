import type { NextConfig } from "next";
import "./lib/env";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@watchflow/db"],
};

export default nextConfig;
