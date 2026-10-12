import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as XLSX from 'xlsx';
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

const ARCHIVED_MESSAGE =
  '終了済みのプロジェクトのため、この操作を行うことができません。';

const PARSED_DATA = {
  targetCount: 2,
  okCount: 1,
  ngCount: 0,
  notRunCount: 1,
  excludedCount: 0,
};

// 終了済みプロジェクトでは更新系操作を403にする
describe('終了済みプロジェクトでの更新系操作の制限 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: TestFixture;
  let outsider: TestUser;
  let agent: ReturnType<typeof request.agent>;
  let fileId: string;
  let secondAdminMemberId: string;
  const originalFileName = 'archived_e2e_original.xlsx';

  const projectPath = (path = ''): string =>
    `/projects/${fixture.projectId}${path}`;

  const expectArchivedError = (res: request.Response): void => {
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(ARCHIVED_MESSAGE);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fixture = await createTestFixture(prisma);
    outsider = await createTestUser(prisma, 'outsider');

    // 終了済みでなければ成功する状態を作ってから終了させ、403の原因が終了済みであることだけに絞る。
    // もう1人を管理者にしておくことで、ロール変更・削除・離脱が「管理者0人」の400にならないようにする
    const secondAdmin = await prisma.projectMember.update({
      where: {
        userId_projectId: {
          userId: fixture.viewer.userId,
          projectId: fixture.projectId,
        },
      },
      data: { role: 'admin' },
    });
    secondAdminMemberId = secondAdmin.id;

    agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email: fixture.email, password: fixture.password })
      .expect(200);

    const created = await agent
      .post(projectPath('/test-files/commit'))
      .send({
        files: [
          {
            fileName: originalFileName,
            operation: 'create',
            parsedData: PARSED_DATA,
          },
        ],
      })
      .expect(200);
    fileId = (created.body as { files: { fileId: string }[] }).files[0].fileId;

    await agent.post(projectPath('/archive')).expect(200);
  });

  afterAll(async () => {
    await cleanupTestFixture(prisma, fixture);
    await deleteTestUsers(prisma, [outsider.userId]);
    await app.close();
  });

  describe('テストファイルAPI', () => {
    it('Excel読込のプレビュー（preview）は403になる', async () => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['No', '結果'],
          [1, 'OK'],
        ]),
        'テスト',
      );
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer;

      const res = await agent
        .post(projectPath('/test-files/preview'))
        .attach('files', buffer, 'archived_preview.xlsx');

      expectArchivedError(res);
    });

    it('Excel読込の実行（commit）は403になり、登録されない', async () => {
      const name = 'archived_e2e_new.xlsx';

      const res = await agent.post(projectPath('/test-files/commit')).send({
        files: [{ fileName: name, operation: 'create', parsedData: PARSED_DATA }],
      });

      expectArchivedError(res);
      expect(
        await prisma.testFile.count({
          where: { projectId: fixture.projectId, name },
        }),
      ).toBe(0);
    });

    it('登録取消（remove）は403になり、削除されない', async () => {
      const res = await agent.delete(projectPath(`/test-files/${fileId}`));

      expectArchivedError(res);
      expect(await prisma.testFile.count({ where: { id: fileId } })).toBe(1);
    });
  });

  describe('メンバーAPI', () => {
    it('メンバー追加（addMember）は403になり、追加されない', async () => {
      const res = await agent
        .post(projectPath('/members'))
        .send({ userId: outsider.userId });

      expectArchivedError(res);
      expect(
        await prisma.projectMember.count({
          where: { projectId: fixture.projectId, userId: outsider.userId },
        }),
      ).toBe(0);
    });

    it('ロール変更（changeRole）は403になり、ロールが変わらない', async () => {
      const res = await agent
        .patch(projectPath(`/members/${secondAdminMemberId}`))
        .send({ role: 'tester' });

      expectArchivedError(res);
      const member = await prisma.projectMember.findUniqueOrThrow({
        where: { id: secondAdminMemberId },
      });
      expect(member.role).toBe('admin');
    });

    it('メンバー削除（removeMember）は403になり、削除されない', async () => {
      const res = await agent.delete(
        projectPath(`/members/${secondAdminMemberId}`),
      );

      expectArchivedError(res);
      expect(
        await prisma.projectMember.count({ where: { id: secondAdminMemberId } }),
      ).toBe(1);
    });

    it('離脱（leave）は403になり、メンバーのまま残る', async () => {
      const res = await agent.post(projectPath('/members/leave'));

      expectArchivedError(res);
      expect(
        await prisma.projectMember.count({
          where: { projectId: fixture.projectId, userId: fixture.userId },
        }),
      ).toBe(1);
    });
  });

  describe('プロジェクトAPI', () => {
    it('プロジェクト名変更（update）は403になり、名前が変わらない', async () => {
      const before = await prisma.project.findUniqueOrThrow({
        where: { id: fixture.projectId },
      });

      const res = await agent
        .patch(projectPath())
        .send({ name: '終了後に変更しようとした名前' });

      expectArchivedError(res);
      const after = await prisma.project.findUniqueOrThrow({
        where: { id: fixture.projectId },
      });
      expect(after.name).toBe(before.name);
    });
  });

  describe('制限の対象外・判定順', () => {
    it('読み取り系の操作（詳細・メンバー一覧・ファイル一覧）は終了後も利用できる', async () => {
      await agent.get(projectPath()).expect(200);
      await agent.get(projectPath('/members')).expect(200);
      await agent.get(projectPath('/test-files')).expect(200);
    });

    it('未参加のユーザーには、終了済みであることを伝えず404を返す', async () => {
      const outsiderAgent = request.agent(app.getHttpServer());
      await outsiderAgent
        .post('/auth/login')
        .send({ email: outsider.email, password: outsider.password })
        .expect(200);

      const res = await outsiderAgent
        .patch(projectPath())
        .send({ name: '未参加者による変更' });

      expect(res.status).toBe(404);
      expect(res.body.message).not.toBe(ARCHIVED_MESSAGE);
    });
  });
});
