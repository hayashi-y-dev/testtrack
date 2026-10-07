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

// 「進行中プロジェクトのメンバーは必ずタブの表示順（order）を持ち、終了済みはNULL」という前提
// （db-schema.md 2-3節）が、参加・終了の各入口で保たれることを確認する
describe('進行中プロジェクトのタブ表示順 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: TestFixture;
  let member: TestUser;
  let newcomer: TestUser;
  let adminAgent: ReturnType<typeof request.agent>;
  // テスト中にAPI・Prismaで作ったプロジェクト。ユーザーより先に消す必要があるため控えておく
  const createdProjectIds: string[] = [];

  const displayOrderOf = async (
    userId: string,
    projectId: string,
  ): Promise<number | null | undefined> => {
    const m = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { displayOrder: true },
    });
    return m?.displayOrder;
  };

  // 指定ユーザーが参加するプロジェクトを、Prismaで直接作る（APIを通さず前提の状態を用意するため）
  const createProjectFor = async (
    userId: string,
    status: 'active' | 'archived',
    displayOrder: number | null,
  ): Promise<string> => {
    const project = await prisma.project.create({
      data: {
        name: `E2E表示順 ${status}`,
        status,
        members: { create: { userId, role: 'admin', displayOrder } },
      },
    });
    createdProjectIds.push(project.id);
    return project.id;
  };

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

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fixture = await createTestFixture(prisma);
    member = await createTestUser(prisma, 'member');
    newcomer = await createTestUser(prisma, 'newcomer');
    adminAgent = await loginAgent(fixture);
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { id: { in: createdProjectIds } },
    });
    await cleanupTestFixture(prisma, fixture);
    await deleteTestUsers(prisma, [member.userId, newcomer.userId]);
    await app.close();
  });

  describe('プロジェクト作成（2-2）', () => {
    it('作成したプロジェクトは、作成者の進行中プロジェクトの末尾（最大値+1）になる', async () => {
      // 終了済みプロジェクトの値は最大値の計算に含めない
      await createProjectFor(fixture.userId, 'archived', null);

      const res = await adminAgent
        .post('/projects')
        .send({ name: 'E2E表示順 作成' })
        .expect(201);
      const created = res.body as { id: string; order: number };
      createdProjectIds.push(created.id);

      // フィクスチャのプロジェクトが0なので、その次の1になる
      expect(created.order).toBe(1);
      expect(await displayOrderOf(fixture.userId, created.id)).toBe(1);

      const list = await adminAgent.get('/projects').expect(200);
      const active = (
        list.body as { projects: { id: string; status: string }[] }
      ).projects.filter((p) => p.status === 'active');
      expect(active.at(-1)?.id).toBe(created.id);
    });
  });

  describe('メンバー追加（3-3）', () => {
    it('追加された人の、進行中プロジェクトの末尾（最大値+1）になる', async () => {
      await createProjectFor(member.userId, 'active', 0);
      await createProjectFor(member.userId, 'active', 1);
      await createProjectFor(member.userId, 'archived', null);

      await adminAgent
        .post(`/projects/${fixture.projectId}/members`)
        .send({ userId: member.userId })
        .expect(201);

      expect(await displayOrderOf(member.userId, fixture.projectId)).toBe(2);

      // 追加された人から見た一覧でも、進行中プロジェクトの最後に並ぶ
      const memberAgent = await loginAgent(member);
      const list = await memberAgent.get('/projects').expect(200);
      const active = (
        list.body as { projects: { id: string; status: string }[] }
      ).projects.filter((p) => p.status === 'active');
      expect(active.map((p) => p.id)).toHaveLength(3);
      expect(active.at(-1)?.id).toBe(fixture.projectId);
    });

    it('進行中プロジェクトに1つも参加していない人は0になる', async () => {
      await adminAgent
        .post(`/projects/${fixture.projectId}/members`)
        .send({ userId: newcomer.userId })
        .expect(201);

      expect(await displayOrderOf(newcomer.userId, fixture.projectId)).toBe(0);
    });
  });

  describe('プロジェクト終了（2-5）', () => {
    it('終了したプロジェクトの全メンバーの表示順がNULLになる', async () => {
      // 上のテストで追加した2人を含め、全員に値が入っている状態から終了させる
      const before = await prisma.projectMember.findMany({
        where: { projectId: fixture.projectId },
        select: { displayOrder: true },
      });
      expect(before.length).toBeGreaterThanOrEqual(4);
      expect(before.every((m) => m.displayOrder !== null)).toBe(true);

      await adminAgent
        .post(`/projects/${fixture.projectId}/archive`)
        .expect(200);

      const after = await prisma.projectMember.findMany({
        where: { projectId: fixture.projectId },
        select: { displayOrder: true },
      });
      expect(after.every((m) => m.displayOrder === null)).toBe(true);
    });

    it('他のプロジェクトのメンバーの表示順には影響しない', async () => {
      const others = await prisma.projectMember.findMany({
        where: {
          userId: member.userId,
          project: { status: 'active' },
        },
        select: { displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      });
      expect(others.map((m) => m.displayOrder)).toEqual([0, 1]);
    });
  });
});
