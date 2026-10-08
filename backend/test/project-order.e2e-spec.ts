import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers/test-app.js';

// タブ並び順保存API（api-design.md 2-6）を確認する。
// 画面はドロップ時に全件の並びを送り、400なら一覧を取り直すため、保存結果と400の条件をここで固定する
describe('タブ並び順の保存 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: TestUser;
  let outsider: TestUser;
  let agent: ReturnType<typeof request.agent>;
  // 作成順: a → b → c（作成APIにより order は 0, 1, 2）
  const ids: { a: string; b: string; c: string } = { a: '', b: '', c: '' };
  let archivedId: string;
  let outsiderProjectId: string;

  const activeOrderFromList = async (): Promise<string[]> => {
    const res = await agent.get('/projects').expect(200);
    return (res.body as { projects: { id: string; status: string }[] }).projects
      .filter((p) => p.status === 'active')
      .map((p) => p.id);
  };

  const createProject = async (name: string): Promise<string> => {
    const res = await agent.post('/projects').send({ name }).expect(201);
    return (res.body as { id: string }).id;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    user = await createTestUser(prisma, 'order');
    outsider = await createTestUser(prisma, 'order-outsider');
    agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    ids.a = await createProject('並び順A');
    ids.b = await createProject('並び順B');
    ids.c = await createProject('並び順C');
    archivedId = await createProject('並び順 終了済み');
    await agent.post(`/projects/${archivedId}/archive`).expect(200);

    const outsiderProject = await prisma.project.create({
      data: {
        name: '並び順 未参加',
        members: {
          create: { userId: outsider.userId, role: 'admin', displayOrder: 0 },
        },
      },
    });
    outsiderProjectId = outsiderProject.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: {
        members: {
          some: { userId: { in: [user.userId, outsider.userId] } },
        },
      },
    });
    await deleteTestUsers(prisma, [user.userId, outsider.userId]);
    await app.close();
  });

  it('全件の並びを保存し、送った内容を返す。一覧も保存した順で返る', async () => {
    const orders = [
      { projectId: ids.c, order: 0 },
      { projectId: ids.a, order: 1 },
      { projectId: ids.b, order: 2 },
    ];

    const res = await agent
      .patch('/projects/order')
      .send({ orders })
      .expect(200);

    expect(res.body).toEqual({ orders });
    expect(await activeOrderFromList()).toEqual([ids.c, ids.a, ids.b]);
  });

  it('続けて保存すると、最後に保存した並びになる', async () => {
    await agent
      .patch('/projects/order')
      .send({
        orders: [
          { projectId: ids.b, order: 0 },
          { projectId: ids.c, order: 1 },
          { projectId: ids.a, order: 2 },
        ],
      })
      .expect(200);

    expect(await activeOrderFromList()).toEqual([ids.b, ids.c, ids.a]);
  });

  describe('参加していないプロジェクトが含まれる場合は400を返し、並びを変えない', () => {
    it.each([
      ['参加していないプロジェクト', () => outsiderProjectId],
      ['終了済みのプロジェクト', () => archivedId],
    ])('%s', async (_label, otherId) => {
      const before = await activeOrderFromList();

      const res = await agent
        .patch('/projects/order')
        .send({
          orders: [
            { projectId: ids.a, order: 0 },
            { projectId: otherId(), order: 1 },
          ],
        })
        .expect(400);

      expect((res.body as { message: string }).message).toBe(
        '指定されたプロジェクトに、参加していないものが含まれています。',
      );
      expect(await activeOrderFromList()).toEqual(before);
    });
  });

  it('空の配列は400を返す', async () => {
    const res = await agent
      .patch('/projects/order')
      .send({ orders: [] })
      .expect(400);

    expect((res.body as { message: string[] }).message).toContain(
      'ordersには1件以上の項目が必要です。',
    );
  });

  it('未ログインは401を返す', async () => {
    await request(app.getHttpServer())
      .patch('/projects/order')
      .send({ orders: [{ projectId: ids.a, order: 0 }] })
      .expect(401);
  });
});
