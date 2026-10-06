import { INestApplication } from '@nestjs/common';
import type { Application } from 'express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers/test-app.js';

// プロキシ（Funnel→Next.js）経由のHTTPSアクセスでセッションCookieが発行されること。
// supertestはループバック（127.0.0.1）から接続するため、同じマシン上のNext.jsからの転送を模せる
describe('プロキシの信用設定 (e2e)', () => {
  // NODE_ENV はアプリ起動時（setupApp）に読まれるため、モードごとにアプリを起動し直す
  const startApp = async (nodeEnv: string): Promise<INestApplication> => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    try {
      return await createTestApp();
    } finally {
      vi.unstubAllEnvs();
    }
  };

  const login = (
    app: INestApplication,
    user: TestUser,
    forwardedProto?: string,
  ): request.Test => {
    const req = request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    return forwardedProto ? req.set('X-Forwarded-Proto', forwardedProto) : req;
  };

  const sessionCookie = (res: request.Response): string | undefined =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.find(
      (cookie) => cookie.startsWith('connect.sid='),
    );

  describe('本番モード', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let user: TestUser;

    beforeAll(async () => {
      app = await startApp('production');
      prisma = app.get(PrismaService);
      user = await createTestUser(prisma, 'proxy-prod');
    });

    afterAll(async () => {
      await deleteTestUsers(prisma, [user.userId]);
      await app.close();
    });

    it('プロキシ経由のHTTPS（X-Forwarded-Proto: https）なら、Secure付きのセッションCookieを発行する', async () => {
      const res = await login(app, user, 'https');

      expect(res.status).toBe(200);
      expect(sessionCookie(res)).toMatch(/; Secure/);
    });

    it('Funnel側とNext.js側で転送が重なり、X-Forwarded-Proto が「https,http」になっても、先頭のhttpsで判断する', async () => {
      const res = await login(app, user, 'https,http');

      expect(res.status).toBe(200);
      expect(sessionCookie(res)).toMatch(/; Secure/);
    });

    it('X-Forwarded-Proto のない素のHTTPアクセスでは、セッションCookieを発行しない', async () => {
      const res = await login(app, user);

      expect(res.status).toBe(200);
      expect(sessionCookie(res)).toBeUndefined();
    });

    it('信用するのはループバック（同じマシン上）のプロキシからの転送だけ', () => {
      // Expressが trust proxy の設定から作る判定関数。X-Forwarded-* を信用する接続元かを返す
      const isTrusted = (app.getHttpAdapter().getInstance() as Application).get(
        'trust proxy fn',
      ) as (address: string, hop: number) => boolean;

      expect(isTrusted('127.0.0.1', 0)).toBe(true);
      expect(isTrusted('::1', 0)).toBe(true);
      expect(isTrusted('192.168.1.10', 0)).toBe(false);
      expect(isTrusted('203.0.113.10', 0)).toBe(false);
    });
  });

  describe('開発モード', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let user: TestUser;

    beforeAll(async () => {
      app = await startApp('development');
      prisma = app.get(PrismaService);
      user = await createTestUser(prisma, 'proxy-dev');
    });

    afterAll(async () => {
      await deleteTestUsers(prisma, [user.userId]);
      await app.close();
    });

    it.each([
      ['素のHTTP', undefined],
      ['X-Forwarded-Proto: https', 'https'],
    ])(
      '%sでも、今までどおりSecureなしのセッションCookieを発行する',
      async (_, forwardedProto) => {
        const res = await login(app, user, forwardedProto);

        expect(res.status).toBe(200);
        const cookie = sessionCookie(res);
        expect(cookie).toBeDefined();
        expect(cookie).not.toMatch(/; Secure/);
      },
    );
  });
});
