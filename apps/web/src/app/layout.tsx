import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoLens | AI Visibility Intelligence",
  description: "GEO 监测数据平台 - AI Visibility Intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
