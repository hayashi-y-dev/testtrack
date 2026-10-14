import { DEV_PASSWORD, resolveSeedPassword, waitForDatabase } from './seed-config.js';

describe('resolveSeedPassword（デモ用アカウントのパスワード）', () => {
  const VALID = 'demo-password-for-check'; // 23文字

  describe('正常系', () => {
    it('開発で環境変数がなければ、開発用の値を使う', () => {
      expect(resolveSeedPassword({ NODE_ENV: 'development' })).toEqual({ password: DEV_PASSWORD, source: 'dev' });
    });

    it('NODE_ENV がなくても（開発扱い）、開発用の値を使う', () => {
      expect(resolveSeedPassword({})).toEqual({ password: DEV_PASSWORD, source: 'dev' });
    });

    it('開発で環境変数が空なら、開発用の値を使う', () => {
      expect(resolveSeedPassword({ DEMO_USER_PASSWORD: '' })).toEqual({ password: DEV_PASSWORD, source: 'dev' });
    });

    it('開発で環境変数があれば、その値を使う', () => {
      expect(resolveSeedPassword({ DEMO_USER_PASSWORD: VALID })).toEqual({ password: VALID, source: 'env' });
    });

    it('本番で環境変数があれば、その値を使う', () => {
      expect(resolveSeedPassword({ NODE_ENV: 'production', DEMO_USER_PASSWORD: VALID })).toEqual({
        password: VALID,
        source: 'env',
      });
    });

    it('15文字ちょうど・64文字ちょうどは使える', () => {
      for (const value of ['a'.repeat(15), 'a'.repeat(64)]) {
        expect(resolveSeedPassword({ NODE_ENV: 'production', DEMO_USER_PASSWORD: value }).password).toBe(value);
      }
    });

    it('開発では、環境変数に開発用の値を書いても使える', () => {
      expect(resolveSeedPassword({ DEMO_USER_PASSWORD: DEV_PASSWORD }).password).toBe(DEV_PASSWORD);
    });
  });

  describe('異常系', () => {
    it('本番で環境変数がなければ止める（開発用の値で作らない）', () => {
      expect(() => resolveSeedPassword({ NODE_ENV: 'production' })).toThrow(
        '本番モードでは DEMO_USER_PASSWORD が必要です。',
      );
    });

    it('本番で環境変数が空・空白だけなら止める', () => {
      for (const value of ['', '   ']) {
        expect(() => resolveSeedPassword({ NODE_ENV: 'production', DEMO_USER_PASSWORD: value })).toThrow(
          '本番モードでは DEMO_USER_PASSWORD が必要です。',
        );
      }
    });

    it('14文字以下・65文字以上は、本番でも開発でも止める', () => {
      for (const NODE_ENV of ['production', 'development']) {
        for (const value of ['a'.repeat(14), 'a'.repeat(65)]) {
          expect(() => resolveSeedPassword({ NODE_ENV, DEMO_USER_PASSWORD: value })).toThrow(
            'DEMO_USER_PASSWORD は15文字以上64文字以下にしてください。',
          );
        }
      }
    });

    it('本番で開発用の値（リポジトリで公開されている）を使おうとしたら止める', () => {
      expect(() => resolveSeedPassword({ NODE_ENV: 'production', DEMO_USER_PASSWORD: DEV_PASSWORD })).toThrow(
        '本番モードでは、DEMO_USER_PASSWORD に開発用のパスワードを使えません。',
      );
    });
  });
});

describe('waitForDatabase（DBの起動待ち）', () => {
  // 実際には待たず、sleep で時計を進める
  const fakeClock = () => {
    let t = 0;
    return { now: () => t, sleep: vi.fn(async (ms: number) => { t += ms; }) };
  };

  it('正常系：すぐ接続できれば、待たずに終わる', async () => {
    const ping = vi.fn().mockResolvedValue(1);
    const clock = fakeClock();

    await waitForDatabase(ping, { timeoutMs: 60_000, intervalMs: 2000, ...clock });

    expect(ping).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('正常系：何回か失敗しても、時間内に接続できれば終わる', async () => {
    const ping = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue(1);
    const clock = fakeClock();

    await waitForDatabase(ping, { timeoutMs: 60_000, intervalMs: 2000, ...clock });

    expect(ping).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalledWith(2000);
  });

  it('異常系：決めた時間を過ぎても接続できなければ、元のエラーを付けて止める', async () => {
    const cause = new Error('connection refused');
    const ping = vi.fn().mockRejectedValue(cause);
    const clock = fakeClock();

    const error = await waitForDatabase(ping, { timeoutMs: 10_000, intervalMs: 2000, ...clock }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('データベースに接続できませんでした（10秒待ちました）。');
    expect((error as Error).cause).toBe(cause);
    // 0・2・4・6・8・10秒に試し、10秒の時点で次に待つと上限を超えるので止める
    expect(ping).toHaveBeenCalledTimes(6);
    expect(clock.sleep).toHaveBeenCalledTimes(5);
  });

  it('異常系：1回の試みが遅くても、待つ時間の上限を大きく超えない', async () => {
    const clock = fakeClock();
    // 1回の試みに4秒かかる環境（つながらないポートへの接続がすぐ失敗しない場合）
    const ping = vi.fn(async () => { await clock.sleep(4000); throw new Error('timeout'); });

    await waitForDatabase(ping, { timeoutMs: 60_000, intervalMs: 2000, ...clock }).catch(() => undefined);

    expect(clock.now()).toBeLessThanOrEqual(60_000 + 4000);
  });
});
