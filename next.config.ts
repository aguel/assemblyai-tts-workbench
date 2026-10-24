import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev indicator; compile and runtime errors still show.
  devIndicators: false,
  cacheComponents: true,
};

export default nextConfig;
