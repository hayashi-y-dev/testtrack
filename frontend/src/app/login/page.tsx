'use client';

import { useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './login.module.css';

// 仮のログイン情報（API実装後は削除）
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'password';

/**
 * ログイン画面
 * 仕様書セクション1-1, 1-6に基づく実装
 * - メールアドレス＋パスワードでログイン
 * - ログイン失敗時は、どちらが誤りかを特定する文言にしない
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * 入力バリデーション（仕様書1-6準拠）
   * - メールアドレス: 必須、前後空白除去、メール形式、最大255文字
   * - パスワード: 必須
   */
  const validateForm = (): boolean => {
    const newErrors: { email?: string; password?: string } = {};

    // メールアドレスのバリデーション
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      newErrors.email = 'メールアドレスを入力してください。';
    } else if (trimmedEmail.length > 255) {
      newErrors.email = 'メールアドレスは255文字以内で入力してください。';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      newErrors.email = '有効なメールアドレス形式で入力してください。';
    }

    // パスワードのバリデーション
    if (!password) {
      newErrors.password = 'パスワードを入力してください。';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    // API未実装のため、仮実装としてコンソールログ出力
    console.log('ログイン試行:', {
      email: email.trim(),
      password: '********', // セキュリティのため実際の値は出力しない
    });

    // 仮のログイン処理シミュレーション
    // 実際のAPI実装後はここでAPIを呼び出す
    setTimeout(() => {
      const trimmedEmail = email.trim();
      if (trimmedEmail === DEMO_EMAIL && password === DEMO_PASSWORD) {
        // ログイン成功: ダッシュボードへ遷移
        router.push('/dashboard');
      } else {
        // ログイン失敗（仕様書1-1: どちらが誤りか特定しない文言）
        setLoginError('メールアドレスまたはパスワードが正しくありません。');
        setIsSubmitting(false);
      }
    }, 500);
  };

  return (
    <div className={styles.loginWrap}>
      <div className={styles.brand}>
        <div className={styles.brandText}>
          <div className={styles.brandName}>
            Test<span className={styles.accent}>Track</span>
          </div>
          <div className={styles.brandTag}>テスト進捗をシンプルに共有</div>
        </div>
      </div>

      <div className={styles.card}>
        <h1 className={styles.cardTitle}>ログイン</h1>

        {loginError && (
          <div className={styles.errorBanner}>
            <div className={styles.errorIcon}>!</div>
            <div>{loginError}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className={`${styles.field} ${errors.email ? styles.fieldError : ''}`}>
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
                if (errors.email) {
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }
              }}
              className={styles.input}
              maxLength={255}
            />
            {errors.email && <div className={styles.fieldErrorText}>{errors.email}</div>}
          </div>

          <div className={`${styles.field} ${errors.password ? styles.fieldError : ''}`}>
            <label htmlFor="password" className={styles.label}>
              パスワード
            </label>
            <input
              type="password"
              id="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              className={styles.input}
            />
            {errors.password && <div className={styles.fieldErrorText}>{errors.password}</div>}
          </div>

          <div className={styles.rowBetween}>
            {/* パスワード再設定画面への仮リンク（別途実装） */}
            <Link href="/password-reset" className={styles.link}>
              パスワードを忘れた方はこちら
            </Link>
          </div>

          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>

      <div className={styles.footnote}>© TestTrack</div>
    </div>
  );
}
