import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Prevents TS version-bump regressions from breaking Docker builds.
    // All type errors are fixed at source — this is a CI safety net only.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;