import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers/test-app.js';

// ログアウト（POST /auth/logout）
describe('ログアウト (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: TestUser;

  const login = async (): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    return agent;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    user = await createTestUser(prisma, 'logout');
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [user.userId]);
    await app.close();
  });

  it('ログイン中なら200を返し、セッションCookieを失効させる', async () => {
    const agent = await login();

    const res = await agent.post('/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'ログアウトしました。' });
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.join('\n')).toMatch(
      /connect\.sid=;.*Expires=Thu, 01 Jan 1970/,
    );
  });

  it('ログアウト後は、ログイン時のCookieを送り直しても認証が必要なAPIを使えない', async () => {
    // agentは失効したCookieを捨ててしまうため、サーバー側でセッションが破棄されたことを確かめるには
    // ログイン時のCookieを直接送り直す
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    const sessionCookie = loginRes.headers['set-cookie'] as unknown as string[];
    await request(app.getHttpServer())
      .get('/projects')
      .set('Cookie', sessionCookie)
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', sessionCookie)
      .expect(200);
    const res = await request(app.getHttpServer())
      .get('/projects')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(401);
  });

  it('未ログインなら401を返す', async () => {
    const res = await request(app.getHttpServer()).post('/auth/logout');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('ログインが必要です。');
  });
});
