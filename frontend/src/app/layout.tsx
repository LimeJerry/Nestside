import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Nestside · 나의 파일 보관함",
  description: "내부망 개발용 Nestside 개인 클라우드 파일 관리",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
