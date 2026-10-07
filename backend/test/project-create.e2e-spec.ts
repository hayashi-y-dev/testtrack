import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers/test-app.js';

// プロジェクト作成API（api-design.md 2-2）の入力規則（仕様書2-2・9-1）と、
// 画面が一覧を取り直さずにタブへ加えるために使う201のレスポンスを確認する
describe('プロジェクト作成 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: TestUser;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    user = await createTestUser(prisma, 'creator');
    agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
  });

  afterAll(async () => {
    // 作成したプロジェクトを先に消す（ユーザーはメンバーからRestrictで参照されているため）
    await prisma.project.deleteMany({
      where: { members: { some: { userId: user.userId } } },
    });
    await deleteTestUsers(prisma, [user.userId]);
    await app.close();
  });

  it('前後の空白を除いた名前で作成し、作成者を管理者・末尾の並び順で返す', async () => {
    const res = await agent
      .post('/projects')
      .send({ name: '　 作成テスト \t' })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String) as string,
      name: '作成テスト',
      status: 'active',
      myRole: 'admin',
      order: 0,
    });

    const second = await agent
      .post('/projects')
      .send({ name: '作成テスト2' })
      .expect(201);
    expect((second.body as { order: number }).order).toBe(1);
  });

  it('50文字ちょうどは作成できる', async () => {
    const name = 'あ'.repeat(50);
    const res = await agent.post('/projects').send({ name }).expect(201);
    expect((res.body as { name: string }).name).toBe(name);
  });

  it('同名のプロジェクトも作成できる（仕様書2-2）', async () => {
    await agent.post('/projects').send({ name: '同名' }).expect(201);
    await agent.post('/projects').send({ name: '同名' }).expect(201);
  });

  describe('入力が不正な場合は400を返し、作成しない', () => {
    it.each([
      ['空', '', 'プロジェクト名は必須です。'],
      ['空白のみ', ' 　\t', 'プロジェクト名は必須です。'],
      [
        '51文字',
        'あ'.repeat(51),
        'プロジェクト名は50文字以内で入力してください。',
      ],
      [
        '改行を含む',
        '改行\nあり',
        'プロジェクト名に改行を含めることはできません。',
      ],
    ])('%s', async (_label, name, expected) => {
      const before = await prisma.projectMember.count({
        where: { userId: user.userId },
      });

      const res = await agent.post('/projects').send({ name }).expect(400);

      expect((res.body as { message: string[] }).message).toContain(expected);
      expect(
        await prisma.projectMember.count({ where: { userId: user.userId } }),
      ).toBe(before);
    });
  });

  it('未ログインは401を返す', async () => {
    await request(app.getHttpServer())
      .post('/projects')
      .send({ name: '未ログイン' })
      .expect(401);
  });
});
