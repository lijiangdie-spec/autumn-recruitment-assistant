import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "秋招助手",
  description: "本机优先的岗位、求职素材、定制简历与投递进度工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
