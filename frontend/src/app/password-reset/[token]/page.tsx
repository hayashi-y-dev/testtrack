'use client';

import { useState, type SubmitEvent } from 'react';
import Link from 'next/link';
import styles from './reset.module.css';

/**
 * パスワード再設定画面
 * 仕様書セクション1-5, 1-6に基づく実装
 * - メールで送信されたトークン付きURLからアクセス
 * - 新しいパスワードを設定
 */
export default function PasswordResetPage() {
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const isPasswordValid = password.length >= 15 && password.length <= 64;

  /**
   * パスワードのバリデーション（仕様書1-6準拠）
   * - 必須
   * - 15〜64文字
   * - 文字種の指定なし
   */
  const validatePassword = (): boolean => {
    if (!password) {
      setPasswordError('パスワードを入力してください。');
      return false;
    }

    if (password.length < 15 || password.length > 64) {
      setPasswordError('パスワードは15文字以上64文字以下で入力してください。');
      return false;
    }

    setPasswordError(null);
    return true;
  };

  /**
   * 確認用パスワードのバリデーション
   */
  const validateConfirm = (): boolean => {
    if (!passwordConfirm) {
      setConfirmError('確認用パスワードを入力してください。');
      return false;
    }

    if (password !== passwordConfirm) {
      setConfirmError('パスワードが一致しません。');
      return false;
    }

    setConfirmError(null);
    return true;
  };

  const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();

    const isPasswordOk = validatePassword();
    const isConfirmOk = validateConfirm();

    if (!isPasswordOk || !isConfirmOk) {
      return;
    }

    setIsSubmitting(true);

    // API未実装のため、仮実装としてコンソールログ出力
    console.log('パスワード再設定:', {
      // 実際のAPI実装時はトークンとパスワードを送信
      password: '***',
    });

    // 仮のAPI呼び出しシミュレーション
    setTimeout(() => {
      setIsCompleted(true);
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
        {!isCompleted ? (
          // 入力フォーム状態
          <div>
            <h1 className={styles.cardTitle}>新しいパスワードの設定</h1>
            <p className={styles.cardDesc}>新しいパスワードを入力してください。</p>

            <form onSubmit={handleSubmit} noValidate>
              <div className={`${styles.field} ${passwordError ? styles.fieldError : ''}`}>
                <label htmlFor="password" className={styles.label}>
                  新しいパスワード
                </label>
                <input
                  type="password"
                  id="password"
                  placeholder="15〜64文字"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) {
                      setPasswordError(null);
                    }
                  }}
                  className={styles.input}
                  maxLength={64}
                />
                {passwordError && <div className={styles.fieldErrorText}>{passwordError}</div>}
                <div className={`${styles.pwHintRow} ${isPasswordValid ? styles.pwHintOk : ''}`}>
                  <div className={styles.pwHintDot}>✓</div>
                  <span>15文字以上64文字以下（文字種の指定はありません）</span>
                </div>
              </div>

              <div className={`${styles.field} ${confirmError ? styles.fieldError : ''}`}>
                <label htmlFor="passwordConfirm" className={styles.label}>
                  新しいパスワード（確認用）
                </label>
                <input
                  type="password"
                  id="passwordConfirm"
                  placeholder="もう一度入力してください"
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(e) => {
                    setPasswordConfirm(e.target.value);
                    if (confirmError) {
                      setConfirmError(null);
                    }
                  }}
                  className={styles.input}
                  maxLength={64}
                />
                {confirmError && <div className={styles.fieldErrorText}>{confirmError}</div>}
              </div>

              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={isSubmitting}
              >
                {isSubmitting ? '変更中...' : 'パスワードを変更する'}
              </button>
            </form>
          </div>
        ) : (
          // 成功状態
          <div>
            <div className={styles.sentIcon}>✓</div>
            <p className={styles.sentMessage}>パスワードを変更しました。</p>
            <div className={styles.backRow}>
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
