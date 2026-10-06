'use client';

import { useState, type ComponentProps } from 'react';
import styles from './PasswordInput.module.css';

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & { id: string };

/**
 * 入力した文字を「表示」ボタンで確認できるパスワード入力欄
 * - 初期状態は伏せ字。表示状態は欄ごとに持ち、画面を開き直すと伏せ字に戻る
 * - 入力欄の見た目は、呼び出し側の className（各画面の .input やエラー時のスタイル）をそのまま使う
 */
export default function PasswordInput(props: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className={styles.wrap}>
      {/* 自動入力・保存が今までどおり働くよう、autoComplete などの属性は呼び出し側の指定をそのまま渡す */}
      <input {...props} type={isVisible ? 'text' : 'password'} />
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setIsVisible((visible) => !visible)}
        aria-controls={props.id}
        // 見た目の「表示／隠す」だけでは何を切り替えるか伝わらないため、読み上げ用の名前を付ける
        aria-label={isVisible ? 'パスワードを隠す' : 'パスワードを表示する'}
      >
        {isVisible ? '隠す' : '表示'}
      </button>
    </div>
  );
}
