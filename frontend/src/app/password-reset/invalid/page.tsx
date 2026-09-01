'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './invalid.module.css';

/**
 * リンク無効/期限切れ画面
 * 仕様書セクション1-5に基づく実装
 * - トークンが無効または期限切れの場合に表示
 * - 再設定メールを再送する機能
 */
export default function PasswordResetInvalidPage() {
  const [isResent, setIsResent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResend = async () => {
    setIsSubmitting(true);

    // API未実装のため、仮実装としてコンソールログ出力
    console.log('再設定メール再送リクエスト');

    // 仮のAPI呼び出しシミュレーション
    setTimeout(() => {
      setIsResent(true);
      setIsSubmitting(false);
    }, 500);
  };

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
        {!isResent ? (
          // デフォルト状態（無効/期限切れ）
          <div>
            <div className={styles.iconCircle}>!</div>
            <h1 className={styles.cardTitle}>このリンクは利用できません</h1>
            <p className={styles.cardDesc}>
              有効期限が切れているか、すでに使用されています。
              <br />
              お手数ですが、再設定メールを送り直してください。
            </p>
            <button
              className={styles.btnPrimary}
              onClick={handleResend}
              disabled={isSubmitting}
            >
              {isSubmitting ? '送信中...' : '再設定メールを再送する'}
            </button>
            <div className={styles.backRow}>
              <Link href="/login" className={styles.linkMuted}>
                ログイン画面に戻る
              </Link>
            </div>
          </div>
        ) : (
          // 再送完了状態
          <div>
            <div className={styles.resentIcon}>✓</div>
            <h1 className={styles.cardTitle}>再設定メールを送信しました</h1>
            <p className={styles.cardDesc}>
              登録されているメールアドレスの場合、
              <br />
              再設定用メールを送信しました。
              <br />
              リンクの有効期限は30分です。
            </p>
            <div className={styles.backRowCenter}>
              <Link href="/login" className={styles.link}>
                ログイン画面に戻る
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className={styles.footnote}>© TestTrack</div>
    </div>
  );
}
