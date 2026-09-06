import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 仅用于隔离验证构建（如本地 dev 占用默认 .next 时）：NEXT_DIST_DIR=.next-zh next build
  // 默认不设，行为与之前完全一致。
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
