/**
 * バックエンドAPIの呼び出し口
 * next.config.ts の rewrites により、/api/... はバックエンドへ転送される（同一オリジン）。
 */

// 500・通信失敗など、APIの文言をそのまま表示できない場合に全画面で共通して使う文言
export const NETWORK_ERROR_MESSAGE =
  '通信エラーが発生しました。時間をおいて、もう一度お試しください。';

// NestJSが想定外の例外に返す既定の英語文言。画面にそのまま出さないよう、messages から除く
const NEST_DEFAULT_ERROR_MESSAGE = 'Internal server error';

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  // status は通信自体に失敗した場合 0 とする。
  // messages はAPIの message（文字列または配列）を配列にそろえたもの。
  // 本文がJSONでない場合（バックエンド停止時に転送が失敗した場合など）は空配列になる。
  // body はJSONの本文そのもの（JSONでない・通信失敗のときは null）。message 以外の項目を読むときに使う
  | { ok: false; status: number; messages: string[]; body: unknown };

export function apiGet<T>(path: string): Promise<ApiResult<T>> {
  return request<T>('GET', path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>('POST', path, body);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  return request<T>('PATCH', path, body);
}

export function apiDelete<T>(path: string): Promise<ApiResult<T>> {
  return request<T>('DELETE', path);
}

// ファイルを multipart/form-data で送る（Excel読込のプレビュー）
export function apiPostForm<T>(path: string, form: FormData): Promise<ApiResult<T>> {
  return request<T>('POST', path, form);
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  // FormData のときは Content-Type を付けない（区切り文字入りの値をブラウザが付けるため）
  const isForm = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, messages: [], body: null };
  }

  const json: unknown = await response.json().catch(() => null);

  if (response.ok) {
    return { ok: true, status: response.status, data: json as T };
  }
  return { ok: false, status: response.status, messages: extractMessages(json), body: json };
}

function extractMessages(json: unknown): string[] {
  if (typeof json !== 'object' || json === null || !('message' in json)) {
    return [];
  }
  const { message } = json;
  const messages = Array.isArray(message) ? message : [message];
  return messages.filter(
    (m): m is string => typeof m === 'string' && m !== NEST_DEFAULT_ERROR_MESSAGE,
  );
}
