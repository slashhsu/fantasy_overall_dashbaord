import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["fast-xml-parser"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
