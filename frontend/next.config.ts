import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",  // required for production Docker (multi-stage build)
};

export default nextConfig;