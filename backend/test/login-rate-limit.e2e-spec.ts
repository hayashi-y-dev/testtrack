import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers/test-app.js';

const RATE_LIMIT_MESSAGE =
  'ログインの試行回数が上限に達しました。しばらくしてから、もう一度お試しください。';

// ログインのレート制限（クライアントIPごとに1分間5回まで）。
// supertestはループバックから接続するため、trust proxy により X-Forwarded-For の値がクライアントIPになる。
// テスト同士で回数が混ざらないよう、テストごとに別のIP（文書用のアドレス範囲）を使う
describe('ログインのレート制限 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: TestUser;

  const loginFrom = (
    clientIp: string,
    password = user.password,
  ): request.Test =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', clientIp)
      .send({ email: user.email, password });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    user = await createTestUser(prisma, 'rate-limit');
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [user.userId]);
    await app.close();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('同じIPから1分間に5回までは試行でき、成功・失敗とも数えて6回目は429になる', async () => {
    const ip = '192.0.2.1';
    const statuses: number[] = [];
    for (const password of [
      'wrong',
      'wrong',
      'wrong',
      user.password,
      user.password,
    ]) {
      statuses.push((await loginFrom(ip, password)).status);
    }

    const res = await loginFrom(ip);

    expect(statuses).toEqual([401, 401, 401, 200, 200]);
    expect(res.status).toBe(429);
  });

  it('429のメッセージは日本語の1文だけで、英語の既定文言を含まない', async () => {
    const ip = '192.0.2.2';
    for (let i = 0; i < 5; i++) {
      await loginFrom(ip);
    }

    const res = await loginFrom(ip);

    expect(res.status).toBe(429);
    expect(res.body.message).toBe(RATE_LIMIT_MESSAGE);
    expect(JSON.stringify(res.body)).not.toMatch(
      /Too Many Requests|ThrottlerException/,
    );
  });

  it('429には、制限が解けるまでの秒数（1〜60秒の整数）を Retry-After ヘッダーで付ける', async () => {
    const ip = '192.0.2.7';
    for (let i = 0; i < 5; i++) {
      await loginFrom(ip);
    }

    const res = await loginFrom(ip);

    expect(res.status).toBe(429);
    const retryAfter = res.headers['retry-after'];
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
  });

  it('IPが違えば別枠で数え、同じIPならセッションが違っても回数を共有する', async () => {
    const blockedIp = '192.0.2.3';
    for (let i = 0; i < 5; i++) {
      await loginFrom(blockedIp);
    }

    // 別のIPは、上限に達したIPの影響を受けない
    expect((await loginFrom('198.51.100.3')).status).toBe(200);
    // 同じIPなら、別のクライアント（別のagent・Cookieなし）でも上限に達している
    const otherClient = request.agent(app.getHttpServer());
    const res = await otherClient
      .post('/auth/login')
      .set('X-Forwarded-For', blockedIp)
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(429);
  });

  it('Funnel→Next.jsの転送でX-Forwarded-Forが複数になっても、先頭の実際のクライアントIPで数える', async () => {
    // 転送経路のアドレス（ループバック）は信用済みのため飛ばされ、クライアントIPが残る
    const clientIp = '192.0.2.4';
    for (let i = 0; i < 5; i++) {
      await loginFrom(`${clientIp}, 127.0.0.1`);
    }

    expect((await loginFrom(clientIp)).status).toBe(429);
  });

  it('上限に達しても、1分たてば同じIPで再びログインできる', async () => {
    // 1分間を実際に待たずに済むよう、時計（Date）だけを偽物にして進める。
    // 制限の回数は Date.now() を基準に数えられている（@nestjs/throttler の ThrottlerStorageService）
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const ip = '192.0.2.5';
    for (let i = 0; i < 5; i++) {
      await loginFrom(ip);
    }
    expect((await loginFrom(ip)).status).toBe(429);

    vi.setSystemTime(Date.now() + 59_000);
    expect((await loginFrom(ip)).status).toBe(429);

    vi.setSystemTime(Date.now() + 2_000);
    expect((await loginFrom(ip)).status).toBe(200);
  });

  it('ログイン以外のAPI（パスワード再設定申請など）には制限をかけない', async () => {
    const ip = '192.0.2.6';
    for (let i = 0; i < 6; i++) {
      await loginFrom(ip);
    }

    for (let i = 0; i < 6; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/password-reset-request')
        .set('X-Forwarded-For', ip)
        .send({ email: 'e2e-not-registered@example.com' });
      expect(res.status).toBe(200);
    }
  });
});
