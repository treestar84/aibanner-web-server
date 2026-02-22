import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 트렌드 위젯",
  description: "실시간 AI 키워드 랭킹 — 지금 가장 주목받는 AI 트렌드",
  openGraph: {
    title: "AI 트렌드 위젯",
    description: "실시간 AI 키워드 랭킹",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
