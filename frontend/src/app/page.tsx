import { redirect } from 'next/navigation';

/**
 * ルートページ
 * ログイン画面にリダイレクト
 * （認証実装後は、ログイン済みならダッシュボードへ、未ログインならログイン画面へ）
 */
export default function Home() {
  redirect('/login');
}
