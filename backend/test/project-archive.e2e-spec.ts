import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestFixture,
  createTestApp,
  createTestFixture,
  createTestUser,
  deleteTestUsers,
  type TestFixture,
  type TestUser,
} from './helpers/test-app.js';

// プロジェクト終了API（api-design.md 2-5）のレスポンスを確認する。
// 画面は200の内容で終了済みへ移し、400・403・404はそれぞれの扱いに分けるため、その前提をここで固定する
describe('プロジェクト終了 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: TestFixture;
  let outsider: TestUser;

  const archivePath = (): string => `/projects/${fixture.projectId}/archive`;

  const loginAgent = async (
    user: TestUser,
  ): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    return agent;
  };

  const projectStatus = async (): Promise<string | undefined> =>
    (
      await prisma.project.findUnique({
        where: { id: fixture.projectId },
        select: { status: true },
      })
    )?.status;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fixture = await createTestFixture(prisma);
    outsider = await createTestUser(prisma, 'outsider');
  });

  afterAll(async () => {
    await cleanupTestFixture(prisma, fixture);
    await deleteTestUsers(prisma, [outsider.userId]);
    await app.close();
  });

  // 終了させる前に、失敗するケースを先に確かめる（終了は取り消せないため）
  it('未ログインは401を返し、終了しない', async () => {
    await request(app.getHttpServer()).post(archivePath()).expect(401);
    expect(await projectStatus()).toBe('active');
  });

  it('参加していないユーザーは404を返し、終了しない', async () => {
    const agent = await loginAgent(outsider);

    const res = await agent.post(archivePath()).expect(404);

    expect((res.body as { message: string }).message).toBe(
      '指定されたプロジェクトが見つかりません。',
    );
    expect(await projectStatus()).toBe('active');
  });

  it('管理者以外は403を返し、終了しない', async () => {
    const agent = await loginAgent(fixture.viewer);

    const res = await agent.post(archivePath()).expect(403);

    expect((res.body as { message: string }).message).toBe(
      'この操作を行う権限がありません。',
    );
    expect(await projectStatus()).toBe('active');
  });

  it('管理者は終了でき、終了後の状態（id・名前・archived）を返す', async () => {
    const agent = await loginAgent(fixture);

    const res = await agent.post(archivePath()).expect(200);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: fixture.projectId },
    });
    expect(res.body).toEqual({
      id: fixture.projectId,
      name: project.name,
      status: 'archived',
    });
    expect(project.status).toBe('archived');
  });

  it('すでに終了済みなら400を返す', async () => {
    const agent = await loginAgent(fixture);

    const res = await agent.post(archivePath()).expect(400);

    expect((res.body as { message: string }).message).toBe(
      'このプロジェクトはすでに終了しています。',
    );
  });
});
