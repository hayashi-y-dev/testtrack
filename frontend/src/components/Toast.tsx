'use client';

import { useEffect, useEffectEvent } from 'react';
import styles from './Toast.module.css';

const DISPLAY_MS = 4000;

type ToastProps = {
  message: string;
  onClose: () => void;
};

/**
 * 一時的なエラー通知（一部の操作の失敗を、画面を止めずに短く知らせる）
 * 表示から数秒で onClose を呼ぶ。同じ文言を続けて表示し直す場合は、呼び出し側で key を変えて作り直す。
 */
export default function Toast({ message, onClose }: ToastProps) {
  // 親の再描画で onClose が作り直されても、表示時間のタイマーをやり直さないようにする
  const handleClose = useEffectEvent(onClose);

  useEffect(() => {
    const timer = setTimeout(() => handleClose(), DISPLAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles.toast} role="alert">
      <div className={styles.icon}>!</div>
      <div>{message}</div>
    </div>
  );
}
