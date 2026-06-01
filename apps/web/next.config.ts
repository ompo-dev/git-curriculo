import type { NextConfig } from "next";

const isTauriBuild = process.env.TAURI_BUILD === "1";

const nextConfig: NextConfig = {
  output: isTauriBuild ? "export" : undefined,
  transpilePackages: ["@gitcurriculo/core", "@gitcurriculo/ui"],
  experimental: {
    externalDir: true
  },
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  }
};

export default nextConfig;
