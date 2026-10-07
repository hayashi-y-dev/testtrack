import { NextResponse, type NextRequest } from 'next/server';

// バックエンド（express-session）が発行するセッションCookieの名前
const SESSION_COOKIE_NAME = 'connect.sid';

/**
 * ログインが必要なページを、ページを返す前に守る（Next.jsのProxy。ページの描画より先に動く）
 * - セッションCookieがなければ、ダッシュボードの中身を返さずにログイン画面へ移す
 * - 判定はCookieの有無だけ。中身が有効か（期限切れなど）はバックエンドが判定し、
 *   APIが401を返したときに画面側でログイン画面へ移す（dashboard/page.tsx）
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }
  // Next.jsは同じサイト内へのリダイレクトを相対パス（Location: /login）に変えて返すため、
  // 本番（Funnel経由のHTTPS）でも、ブラウザが開いているURLを基準にログイン画面へ移る
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // ログインが必要なページだけを対象にする。ログイン・パスワード再設定の画面と、
  // /api の転送（未ログインならバックエンドが401を返す）は対象にしない
  matcher: ['/dashboard/:path*'],
};
