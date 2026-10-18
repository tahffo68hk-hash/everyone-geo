import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/app";
export const metadata: Metadata = {
  title: "GeoLens Mini · 品牌 AI 可见度检测",
  description: "让你的品牌更容易被 AI 推荐",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
