'use client';

import { useState, useEffect, type SubmitEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiPost, NETWORK_ERROR_MESSAGE } from '@/lib/api';
import styles from './reset.module.css';

const INVALID_LINK_PATH = '/password-reset/invalid';

/**
 * パスワード再設定画面
 * 仕様書セクション1-5, 1-6に基づく実装
 * - メールで送信されたトークン付きURL（/password-reset/<token>）からアクセス
 * - 開いた時点でトークンを検証し、無効なら無効リンク画面へ移動する
 * - 新しいパスワードを設定
 */
export default function PasswordResetPage() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const [verifyStatus, setVerifyStatus] = useState<'verifying' | 'valid' | 'failed'>('verifying');
  // 「再読み込み」で検証をやり直すための試行回数（変わるとトークンの検証を再実行する）
  const [verifyAttempt, setVerifyAttempt] = useState(0);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // APIの400は複数のメッセージを返しうるため、配列で持つ（api-design.md 0-3）
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const isPasswordValid = password.length >= 15 && password.length <= 64;

  useEffect(() => {
    // 検証が重なった場合（開発時のStrict Modeでの二重実行など）に、古い結果で上書きしないようにする
    let ignore = false;

    apiPost('/auth/password-reset-token/verify', { token }).then((result) => {
      if (ignore) {
        return;
      }
      if (result.ok) {
        setVerifyStatus('valid');
      } else if (result.status === 401) {
        // ブラウザの「戻る」で使えないリンクの画面に戻らないよう、履歴を置き換える
        router.replace(INVALID_LINK_PATH);
      } else {
        setVerifyStatus('failed');
      }
    });

    return () => {
      ignore = true;
    };
  }, [token, router, verifyAttempt]);

  const handleRetry = () => {
    setVerifyStatus('verifying');
    setVerifyAttempt((attempt) => attempt + 1);
  };

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
    setSubmitErrors([]);

    const isPasswordOk = validatePassword();
    const isConfirmOk = validateConfirm();

    if (!isPasswordOk || !isConfirmOk) {
      return;
    }

    setIsSubmitting(true);

    const result = await apiPost('/auth/password-reset', {
      token,
      newPassword: password,
      confirmPassword: passwordConfirm,
    });

    if (result.ok) {
      setIsCompleted(true);
      return;
    }
    if (result.status === 401) {
      // 入力中に期限切れになった場合など。遷移が終わるまで送信ボタンは無効のままにする
      router.replace(INVALID_LINK_PATH);
      return;
    }

    if (result.status === 400 && result.messages.length > 0) {
      setSubmitErrors(result.messages);
    } else {
      setSubmitErrors([NETWORK_ERROR_MESSAGE]);
    }
    setIsSubmitting(false);
  };

  const renderContent = () => {
    if (verifyStatus === 'verifying') {
      return (
        <div className={styles.statusArea}>
          <div className={styles.spinner}></div>
          <div className={styles.loadingText}>読み込み中…</div>
        </div>
      );
    }

    // 仕様書4-8: 画面データを取得できない場合は、取得失敗メッセージと「再読み込み」を表示する
    if (verifyStatus === 'failed') {
      return (
        <div className={styles.statusArea}>
          <div className={styles.fetchErrorIcon}>!</div>
          <div className={styles.fetchErrorTitle}>リンクを確認できませんでした</div>
          <div className={styles.fetchErrorDesc}>{NETWORK_ERROR_MESSAGE}</div>
          <button type="button" className={styles.btnRetry} onClick={handleRetry}>
            再読み込み
          </button>
        </div>
      );
    }

    if (isCompleted) {
      return (
        <div>
          <div className={styles.sentIcon}>✓</div>
          <p className={styles.sentMessage}>パスワードを変更しました。</p>
          <div className={styles.backRow}>
            <Link href="/login" className={styles.link}>
              ログイン画面に戻る
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div>
        <h1 className={styles.cardTitle}>新しいパスワードの設定</h1>
        <p className={styles.cardDesc}>新しいパスワードを入力してください。</p>

        {submitErrors.length > 0 && (
          <div className={styles.errorBanner}>
            <div className={styles.errorIcon}>!</div>
            <div>
              {submitErrors.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          </div>
        )}

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
    );
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

      <div className={styles.card}>{renderContent()}</div>

      <div className={styles.footnote}>© TestTrack</div>
    </div>
  );
}
