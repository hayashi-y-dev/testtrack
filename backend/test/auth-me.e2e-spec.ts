import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers/test-app.js';

const LOGIN_REQUIRED_MESSAGE = 'ログインが必要です。';

// ログイン中ユーザー取得（GET /auth/me）
describe('ログイン中ユーザー取得 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: TestUser;

  // ログインして、そのときのレスポンスとセッションCookieを返す
  const login = async (
    target: TestUser,
  ): Promise<{ body: unknown; cookie: string[] }> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: target.email, password: target.password })
      .expect(200);
    return {
      body: res.body,
      cookie: res.headers['set-cookie'] as unknown as string[],
    };
  };

  const getMe = (cookie?: string[]): request.Test => {
    const req = request(app.getHttpServer()).get('/auth/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  const expectLoginRequired = (res: request.Response): void => {
    expect(res.status).toBe(401);
    expect((res.body as { message: string }).message).toBe(
      LOGIN_REQUIRED_MESSAGE,
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    user = await createTestUser(prisma, 'me');
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [user.userId]);
    await app.close();
  });

  it('ログイン中なら200で、ログインの成功時と同じ形（id・email・displayName）を返す', async () => {
    const { body: loginBody, cookie } = await login(user);
    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
    });

    const res = await getMe(cookie).expect(200);

    // toEqualで、3項目以外（パスワードのハッシュ・作成日時など）が含まれないことも確かめる
    expect(res.body).toEqual({
      id: user.userId,
      email: user.email,
      displayName: dbUser.displayName,
    });
    expect(res.body).toEqual(loginBody);
    expect(JSON.stringify(res.body)).not.toContain(dbUser.passwordHash);
  });

  it('Cookieがなければ401を返す', async () => {
    expectLoginRequired(await getMe());
  });

  it('ログアウト後は、ログイン時のCookieを送り直しても401を返す', async () => {
    const { cookie } = await login(user);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(200);

    expectLoginRequired(await getMe(cookie));
  });

  it('セッションの有効期限が切れていれば401を返す', async () => {
    const { cookie } = await login(user);
    await getMe(cookie).expect(200);

    // 24時間待つ代わりに、このユーザーのセッションの期限を過去にする
    await prisma.session.updateMany({
      where: { sess: { path: ['userId'], equals: user.userId } },
      data: { expire: new Date(Date.now() - 1000) },
    });

    expectLoginRequired(await getMe(cookie));
  });

  it('セッションは有効でもユーザーが存在しなければ401を返す', async () => {
    const removed = await createTestUser(prisma, 'me-removed');
    const { cookie } = await login(removed);
    await prisma.user.delete({ where: { id: removed.userId } });

    expectLoginRequired(await getMe(cookie));

    await deleteTestUsers(prisma, [removed.userId]);
  });
});
