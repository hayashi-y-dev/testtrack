'use client';

import { useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiPost, NETWORK_ERROR_MESSAGE } from '@/lib/api';
import PasswordInput from '@/components/PasswordInput';
import styles from './login.module.css';

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
  // APIの400は複数のメッセージを返しうるため、配列で持つ（api-design.md 0-3）
  const [loginErrors, setLoginErrors] = useState<string[]>([]);
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
    setLoginErrors([]);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    const result = await apiPost('/auth/login', { email: email.trim(), password });

    if (result.ok) {
      // 遷移が終わるまで送信ボタンを無効のままにし、二重送信を防ぐ
      router.push('/dashboard');
      return;
    }

    // 401（どちらが誤りか特定しない文言。仕様書1-1）・400・429（試行回数の上限）はAPIの文言を表示する。
    // 500・通信失敗はAPIの文言を表示できない（英語の既定文言や、本文がない場合がある）ため共通の文言にする
    const showsApiMessage = [400, 401, 429].includes(result.status);
    if (showsApiMessage && result.messages.length > 0) {
      setLoginErrors(result.messages);
    } else {
      setLoginErrors([NETWORK_ERROR_MESSAGE]);
    }
    setIsSubmitting(false);
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

        {loginErrors.length > 0 && (
          <div className={styles.errorBanner}>
            <div className={styles.errorIcon}>!</div>
            <div>
              {loginErrors.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
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
            <PasswordInput
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
