import Link from 'next/link';
import styles from './invalid.module.css';

/**
 * リンク無効/期限切れ画面
 * 仕様書セクション1-5に基づく実装
 * - トークンが無効または期限切れの場合に表示
 * - 再送の導線として、パスワード再設定の申請画面へ戻るリンクを表示する
 *   （登録の有無を推測させないため、メールアドレスを画面間で持ち回らず、申請画面で入力し直してもらう）
 */
export default function PasswordResetInvalidPage() {
  return (
    <div className={styles.pageWrap}>
      <div className={styles.brand}>
        <div className={styles.brandText}>
          <div className={styles.brandName}>
            Test<span className={styles.accent}>Track</span>
          </div>
          <div className={styles.brandTag}>テスト進捗をシンプルに共有</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.iconCircle}>!</div>
        <h1 className={styles.cardTitle}>このリンクは利用できません</h1>
        <p className={styles.cardDesc}>
          有効期限が切れているか、すでに使用されています。
          <br />
          お手数ですが、パスワード再設定をはじめからやり直してください。
        </p>
        <Link href="/password-reset" className={styles.btnPrimary}>
          パスワード再設定をやり直す
        </Link>
        <div className={styles.backRow}>
          <Link href="/login" className={styles.linkMuted}>
            ログイン画面に戻る
          </Link>
        </div>
      </div>

      <div className={styles.footnote}>© TestTrack</div>
    </div>
  );
}
