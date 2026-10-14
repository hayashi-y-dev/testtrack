// Seed（デモデータの初期化）で、DBに触る前に確かめる値と、DBの起動待ち

// 開発用の共通パスワード。リポジトリで公開されるため、本番では使えないようにする
export const DEV_PASSWORD = 'Password1234!Demo';

// デモ用アカウントのパスワードを入れる環境変数（本番では backend/.env に書く）
export const DEMO_PASSWORD_ENV = 'DEMO_USER_PASSWORD';

// パスワードの長さは、アプリの規則（パスワード再設定と同じ15〜64文字）にそろえる
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 64;

/**
 * デモ用アカウントに設定するパスワードを決める。使えない値なら、DBに触る前にエラーで止める。
 * - 本番（NODE_ENV=production）では環境変数が必須。開発用の値（公開されている）は使えない
 * - 開発では、環境変数がなければ開発用の値を使う
 */
export function resolveSeedPassword(env: NodeJS.ProcessEnv): { password: string; source: 'env' | 'dev' } {
  const value = env[DEMO_PASSWORD_ENV];
  const isProduction = env.NODE_ENV === 'production';

  if (value === undefined || value.trim() === '') {
    if (isProduction) {
      throw new Error(`本番モードでは ${DEMO_PASSWORD_ENV} が必要です。backend/.env に設定してください。`);
    }
    return { password: DEV_PASSWORD, source: 'dev' };
  }
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `${DEMO_PASSWORD_ENV} は${PASSWORD_MIN_LENGTH}文字以上${PASSWORD_MAX_LENGTH}文字以下にしてください。`,
    );
  }
  if (isProduction && value === DEV_PASSWORD) {
    throw new Error(`本番モードでは、${DEMO_PASSWORD_ENV} に開発用のパスワードを使えません。`);
  }
  return { password: value, source: 'env' };
}

/**
 * DBに接続できるまで待つ。EC2の起動直後は、DBのコンテナの準備に数秒かかるため。
 * 1回の接続の試みにかかる時間は環境で変わるので、回数ではなく経過時間で区切る
 */
export async function waitForDatabase(
  ping: () => Promise<unknown>,
  { timeoutMs = 60_000, intervalMs = 2000, sleep = defaultSleep, now = Date.now } = {},
): Promise<void> {
  const startedAt = now();
  for (;;) {
    try {
      await ping();
      return;
    } catch (error) {
      if (now() - startedAt + intervalMs > timeoutMs) {
        throw new Error(`データベースに接続できませんでした（${timeoutMs / 1000}秒待ちました）。`, { cause: error });
      }
      await sleep(intervalMs);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
