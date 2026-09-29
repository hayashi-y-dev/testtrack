import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export interface TestUser {
  userId: string;
  email: string;
  password: string;
}

export interface TestFixture extends TestUser {
  projectId: string;
  // 権限（403）の検証用に、同じプロジェクトへ閲覧者として参加しているユーザー
  viewer: TestUser;
}

const TEST_PASSWORD = 'E2eTestPassword123!';

/**
 * 本番と同じ共通設定（バリデーション・セッション）を適用したテスト用アプリを起動する
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  setupApp(app);
  await app.init();
  return app;
}

/**
 * テスト専用のユーザーを作成する
 */
export async function createTestUser(
  prisma: PrismaService,
  label: string,
): Promise<TestUser> {
  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-${label}-${suffix}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 10),
      displayName: `E2Eテスト ${label} ${suffix}`,
    },
  });
  return { userId: user.id, email, password: TEST_PASSWORD };
}

/**
 * テスト専用のユーザー（管理者・閲覧者）と、その2人が参加するプロジェクトを作成する。
 * 既存の開発データに依存せず、他のテストとも干渉しないよう毎回一意な値で作る
 */
export async function createTestFixture(
  prisma: PrismaService,
): Promise<TestFixture> {
  const admin = await createTestUser(prisma, 'admin');
  const viewer = await createTestUser(prisma, 'viewer');

  const project = await prisma.project.create({
    data: {
      name: `E2Eテスト ${randomUUID().slice(0, 8)}`,
      members: {
        create: [
          { userId: admin.userId, role: 'admin', displayOrder: 0 },
          { userId: viewer.userId, role: 'viewer', displayOrder: 0 },
        ],
      },
    },
  });

  return { ...admin, projectId: project.id, viewer };
}

/**
 * createTestFixtureで作成したデータを削除する
 */
export async function cleanupTestFixture(
  prisma: PrismaService,
  fixture: TestFixture,
): Promise<void> {
  // プロジェクトを消すとメンバー・テストファイル・進捗履歴もCascadeで削除される。
  // ユーザーはそれらからRestrictで参照されているため、プロジェクトより後に消す
  await prisma.project.delete({ where: { id: fixture.projectId } });
  await deleteTestUsers(prisma, [fixture.userId, fixture.viewer.userId]);
}

/**
 * テスト用ユーザーとそのセッションを削除する（参照しているプロジェクトは先に削除しておくこと）
 */
export async function deleteTestUsers(
  prisma: PrismaService,
  userIds: string[],
): Promise<void> {
  for (const userId of userIds) {
    await prisma.session.deleteMany({
      where: { sess: { path: ['userId'], equals: userId } },
    });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
