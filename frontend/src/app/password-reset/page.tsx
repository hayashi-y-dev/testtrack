'use client';

import { useState, type SubmitEvent } from 'react';
import Link from 'next/link';
import { apiPost, NETWORK_ERROR_MESSAGE } from '@/lib/api';
import styles from './password-reset.module.css';

/**
 * パスワード再設定申請画面
 * - 登録メールアドレスを入力して再設定用メールを送信
 * - 未登録メールアドレスでも登録済みと同じメッセージを表示（セキュリティ対策）
 */
export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  // APIの400は複数のメッセージを返しうるため、配列で持つ
  const [requestErrors, setRequestErrors] = useState<string[]>([]);

  /**
   * メールアドレスのバリデーション
   * - 必須
   * - 前後空白除去
   * - メール形式
   * - 最大255文字
   */
  const validateEmail = (): boolean => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setEmailError('メールアドレスを入力してください。');
      return false;
    }

    if (trimmedEmail.length > 255) {
      setEmailError('メールアドレスは255文字以内で入力してください。');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError('有効なメールアドレス形式で入力してください。');
      return false;
    }

    setEmailError(null);
    return true;
  };

  const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setRequestErrors([]);

    if (!validateEmail()) {
      return;
    }

    setIsSubmitting(true);

    const result = await apiPost('/auth/password-reset-request', { email: email.trim() });

    // 登録の有無を推測させないため、200なら常に同じ送信完了状態を表示する
    if (result.ok) {
      setIsSent(true);
    } else if (result.status === 400 && result.messages.length > 0) {
      setRequestErrors(result.messages);
    } else {
      setRequestErrors([NETWORK_ERROR_MESSAGE]);
    }
    setIsSubmitting(false);
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
        {!isSent ? (
          // 入力フォーム状態
          <div>
            <h1 className={styles.cardTitle}>パスワード再設定</h1>
            <p className={styles.cardDesc}>
              登録されているメールアドレスを入力してください。
              <br />
              再設定用のリンクをメールで送信します。
            </p>

            {requestErrors.length > 0 && (
              <div className={styles.errorBanner}>
                <div className={styles.errorIcon}>!</div>
                <div>
                  {requestErrors.map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className={`${styles.field} ${emailError ? styles.fieldError : ''}`}>
                <label htmlFor="email" className={styles.label}>
                  メールアドレス
                </label>
                <input
                  type="email"
                  id="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) {
                      setEmailError(null);
                    }
                  }}
                  className={styles.input}
                  maxLength={255}
                />
                {emailError && <div className={styles.fieldErrorText}>{emailError}</div>}
              </div>

              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={isSubmitting}
              >
                {isSubmitting ? '送信中...' : '再設定メールを送信'}
              </button>
            </form>

            <div className={styles.backRow}>
              <Link href="/login" className={styles.linkMuted}>
                ← ログイン画面に戻る
              </Link>
            </div>
          </div>
        ) : (
          // 送信完了状態
          <div>
            <div className={styles.sentIcon}>✓</div>
            <p className={styles.sentMessage}>
              登録されているメールアドレスの場合、
              <br />
              再設定用メールを送信しました。
            </p>
            <p className={styles.sentSub}>
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
