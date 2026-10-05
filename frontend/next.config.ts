import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // ブラウザからは同一オリジンの /api/... を呼び、Next.jsが /api を外してバックエンドへ転送する。
  // 同一オリジンにすることで、CORSやCookieの追加設定をせずにセッションCookieを使える。
  // 転送先はビルド時の値で固定されるため、変更する場合は next build の前に BACKEND_URL を設定する。
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
