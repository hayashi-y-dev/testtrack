import type { Metadata } from "next";
import { Space_Grotesk, Noto_Sans_JP, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * フォント設定
 * - Space Grotesk: 見出し・ブランド用
 * - Noto Sans JP: 本文用（日本語対応）
 * - JetBrains Mono: 数値・コード用
 */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const notoSansJP = Noto_Sans_JP({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TestTrack — テスト進捗をシンプルに共有",
  description: "Excelテスト仕様書を読み込み、テスト進捗をWeb上で集計・可視化するアプリケーション",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${spaceGrotesk.variable} ${notoSansJP.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
