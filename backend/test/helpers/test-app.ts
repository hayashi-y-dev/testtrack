import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export interface TestFixture {
  userId: string;
  email: string;
  password: string;
  projectId: string;
}

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
 * テスト専用のユーザーと、そのユーザーが管理者のプロジェクトを作成する。
 * 既存の開発データに依存せず、他のテストとも干渉しないよう毎回一意な値で作る
 */
export async function createTestFixture(
  prisma: PrismaService,
): Promise<TestFixture> {
  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-${suffix}@example.com`;
  const password = 'E2eTestPassword123!';

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      displayName: `E2Eテスト ${suffix}`,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: `E2Eテスト ${suffix}`,
      members: {
        create: { userId: user.id, role: 'admin', displayOrder: 0 },
      },
    },
  });

  return { userId: user.id, email, password, projectId: project.id };
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
  await prisma.session.deleteMany({
    where: { sess: { path: ['userId'], equals: fixture.userId } },
  });
  await prisma.user.delete({ where: { id: fixture.userId } });
}
