import { PrismaClient, ProjectStatus, ProjectRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// 開発用共通パスワード。パスワード再設定の規則（15文字以上64文字以下）を満たす値にして、
// 再設定画面でもこの値を設定できるようにする
const DEV_PASSWORD = 'Password1234!Demo';
const SALT_ROUNDS = 10;

async function main() {
  console.log('Seeding database...');

  // パスワードハッシュを生成
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, SALT_ROUNDS);

  // =========================================================================
  // ユーザー（5人）
  // =========================================================================
  const yamada = await prisma.user.create({
    data: {
      email: 'yamada@example.com',
      passwordHash,
      displayName: '山田 太郎',
    },
  });

  const sato = await prisma.user.create({
    data: {
      email: 'sato@example.com',
      passwordHash,
      displayName: '佐藤 花子',
    },
  });

  const tanaka = await prisma.user.create({
    data: {
      email: 'tanaka@example.com',
      passwordHash,
      displayName: '田中 健一',
    },
  });

  const ito = await prisma.user.create({
    data: {
      email: 'ito@example.com',
      passwordHash,
      displayName: '伊藤 由美',
    },
  });

  const nakamura = await prisma.user.create({
    data: {
      email: 'nakamura@example.com',
      passwordHash,
      displayName: '中村 正人',
    },
  });

  console.log('Created 5 users');

  // =========================================================================
  // プロジェクト（4件）
  // =========================================================================
  const ecProject = await prisma.project.create({
    data: {
      name: 'ECサイトリニューアル',
      status: ProjectStatus.active,
    },
  });

  const memberProject = await prisma.project.create({
    data: {
      name: '会員基盤刷新',
      status: ProjectStatus.active,
    },
  });

  const portalProject = await prisma.project.create({
    data: {
      name: '社内ポータル改修',
      status: ProjectStatus.active,
    },
  });

  const legacyProject = await prisma.project.create({
    data: {
      name: '旧基幹システム保守',
      status: ProjectStatus.archived,
    },
  });

  console.log('Created 4 projects');

  // =========================================================================
  // プロジェクトメンバー
  // =========================================================================
  // ECサイトリニューアル: 山田(admin), 佐藤(tester), 伊藤(viewer)
  await prisma.projectMember.createMany({
    data: [
      { userId: yamada.id, projectId: ecProject.id, role: ProjectRole.admin },
      { userId: sato.id, projectId: ecProject.id, role: ProjectRole.tester },
      { userId: ito.id, projectId: ecProject.id, role: ProjectRole.viewer },
    ],
  });

  // 会員基盤刷新: 佐藤(admin), 田中(tester), 山田(viewer)
  await prisma.projectMember.createMany({
    data: [
      { userId: sato.id, projectId: memberProject.id, role: ProjectRole.admin },
      { userId: tanaka.id, projectId: memberProject.id, role: ProjectRole.tester },
      { userId: yamada.id, projectId: memberProject.id, role: ProjectRole.viewer },
    ],
  });

  // 社内ポータル改修: 佐藤(admin), 田中(admin), 山田(tester)
  await prisma.projectMember.createMany({
    data: [
      { userId: sato.id, projectId: portalProject.id, role: ProjectRole.admin },
      { userId: tanaka.id, projectId: portalProject.id, role: ProjectRole.admin },
      { userId: yamada.id, projectId: portalProject.id, role: ProjectRole.tester },
    ],
  });

  // 旧基幹システム保守: 中村(admin), 山田(tester)
  await prisma.projectMember.createMany({
    data: [
      { userId: nakamura.id, projectId: legacyProject.id, role: ProjectRole.admin },
      { userId: yamada.id, projectId: legacyProject.id, role: ProjectRole.tester },
    ],
  });

  console.log('Created project members');

  // =========================================================================
  // テストファイル＆スナップショット
  // =========================================================================

  // -------------------------------------------------------------------------
  // ECサイトリニューアル（12件）
  // -------------------------------------------------------------------------
  const ecFiles = [
    { name: 'ログイン機能_テスト仕様書.xlsx', targetCount: 20, okCount: 17, ngCount: 3, notRunCount: 0, excludedCount: 0, lastUpdatedBy: yamada.id, updatedAt: new Date('2026-09-01') },
    { name: '会員登録機能テスト.xlsx', targetCount: 15, okCount: 8, ngCount: 0, notRunCount: 7, excludedCount: 0, lastUpdatedBy: sato.id, updatedAt: new Date('2026-09-02') },
    // No.3は別途処理（Snapshot2件）
    { name: '検索機能テスト.xlsx', targetCount: 10, okCount: 6, ngCount: 0, notRunCount: 4, excludedCount: 0, lastUpdatedBy: sato.id, updatedAt: new Date('2026-08-28') },
    { name: '商品一覧表示テスト.xlsx', targetCount: 18, okCount: 18, ngCount: 0, notRunCount: 0, excludedCount: 0, lastUpdatedBy: sato.id, updatedAt: new Date('2026-08-30') },
    { name: '2_お問い合わせフォームテスト.xlsx', targetCount: 12, okCount: 6, ngCount: 2, notRunCount: 4, excludedCount: 0, lastUpdatedBy: yamada.id, updatedAt: new Date('2026-09-03') },
    { name: '在庫管理機能に関する非常に長いテスト仕様書のサンプルファイル名です.xlsx', targetCount: 30, okCount: 30, ngCount: 0, notRunCount: 0, excludedCount: 0, lastUpdatedBy: yamada.id, updatedAt: new Date('2026-08-25') },
    { name: '会員情報編集機能テスト.xlsx', targetCount: 8, okCount: 3, ngCount: 1, notRunCount: 4, excludedCount: 0, lastUpdatedBy: sato.id, updatedAt: new Date('2026-09-04') },
    { name: 'クーポン機能テスト.xlsx', targetCount: 14, okCount: 5, ngCount: 2, notRunCount: 7, excludedCount: 0, lastUpdatedBy: yamada.id, updatedAt: new Date('2026-08-29') },
    { name: '10_注文履歴機能テスト.xlsx', targetCount: 9, okCount: 4, ngCount: 2, notRunCount: 3, excludedCount: 0, lastUpdatedBy: sato.id, updatedAt: new Date('2026-09-06') },
    { name: '1_レビュー機能テスト.xlsx', targetCount: 12, okCount: 8, ngCount: 0, notRunCount: 4, excludedCount: 1, lastUpdatedBy: yamada.id, updatedAt: new Date('2026-09-02') },
    { name: '配送設定機能テスト.xlsx', targetCount: 16, okCount: 6, ngCount: 3, notRunCount: 7, excludedCount: 0, lastUpdatedBy: sato.id, updatedAt: new Date('2026-08-27') },
  ];

  for (const file of ecFiles) {
    const testFile = await prisma.testFile.create({
      data: {
        projectId: ecProject.id,
        name: file.name,
        targetCount: file.targetCount,
        okCount: file.okCount,
        ngCount: file.ngCount,
        notRunCount: file.notRunCount,
        excludedCount: file.excludedCount,
        version: 1,
        lastUpdatedBy: file.lastUpdatedBy,
        updatedAt: file.updatedAt,
      },
    });

    // 各ファイルにSnapshot1件
    await prisma.progressSnapshot.create({
      data: {
        testFileId: testFile.id,
        targetCount: file.targetCount,
        okCount: file.okCount,
        ngCount: file.ngCount,
        notRunCount: file.notRunCount,
        excludedCount: file.excludedCount,
        updatedBy: file.lastUpdatedBy,
        createdAt: file.updatedAt,
      },
    });
  }

  // No.3: 決済フロー確認用テスト仕様書_第2版.xlsx（version=2、Snapshot2件）
  const paymentFile = await prisma.testFile.create({
    data: {
      projectId: ecProject.id,
      name: '決済フロー確認用テスト仕様書_第2版.xlsx',
      targetCount: 24,
      okCount: 19,
      ngCount: 2,
      notRunCount: 3,
      excludedCount: 1,
      version: 2,
      lastUpdatedBy: yamada.id,
      updatedAt: new Date('2026-09-05'),
    },
  });

  // Snapshot1件目（初回登録）
  await prisma.progressSnapshot.create({
    data: {
      testFileId: paymentFile.id,
      targetCount: 25,
      okCount: 10,
      ngCount: 1,
      notRunCount: 14,
      excludedCount: 0,
      updatedBy: yamada.id,
      createdAt: new Date('2026-08-20'),
    },
  });

  // Snapshot2件目（更新後＝現在のTestFile本体と同じ値）
  await prisma.progressSnapshot.create({
    data: {
      testFileId: paymentFile.id,
      targetCount: 24,
      okCount: 19,
      ngCount: 2,
      notRunCount: 3,
      excludedCount: 1,
      updatedBy: yamada.id,
      createdAt: new Date('2026-09-05'),
    },
  });

  console.log('Created 12 test files for ECサイトリニューアル');

  // -------------------------------------------------------------------------
  // 会員基盤刷新（0件）
  // -------------------------------------------------------------------------
  // テストファイルなし

  // -------------------------------------------------------------------------
  // 社内ポータル改修（1件）
  // -------------------------------------------------------------------------
  // 全行が「-」対象外のケース（target_count=0, excluded_count=5）
  const portalFile = await prisma.testFile.create({
    data: {
      projectId: portalProject.id,
      name: '契約管理機能テスト.xlsx',
      targetCount: 0,
      okCount: 0,
      ngCount: 0,
      notRunCount: 0,
      excludedCount: 5,
      version: 1,
      lastUpdatedBy: tanaka.id,
    },
  });

  await prisma.progressSnapshot.create({
    data: {
      testFileId: portalFile.id,
      targetCount: 0,
      okCount: 0,
      ngCount: 0,
      notRunCount: 0,
      excludedCount: 5,
      updatedBy: tanaka.id,
    },
  });

  console.log('Created 1 test file for 社内ポータル改修');

  // -------------------------------------------------------------------------
  // 旧基幹システム保守（3件）
  // -------------------------------------------------------------------------
  const legacyFiles = [
    { name: '会員マスタ機能テスト.xlsx', targetCount: 22, okCount: 22, ngCount: 0, notRunCount: 0, excludedCount: 0, updatedAt: new Date('2025-12-10') },
    { name: '帳票出力機能テスト.xlsx', targetCount: 15, okCount: 13, ngCount: 2, notRunCount: 0, excludedCount: 0, updatedAt: new Date('2025-12-12') },
    { name: 'バッチ処理機能テスト.xlsx', targetCount: 10, okCount: 10, ngCount: 0, notRunCount: 0, excludedCount: 0, updatedAt: new Date('2025-12-15') },
  ];

  for (const file of legacyFiles) {
    const testFile = await prisma.testFile.create({
      data: {
        projectId: legacyProject.id,
        name: file.name,
        targetCount: file.targetCount,
        okCount: file.okCount,
        ngCount: file.ngCount,
        notRunCount: file.notRunCount,
        excludedCount: file.excludedCount,
        version: 1,
        lastUpdatedBy: nakamura.id,
        updatedAt: file.updatedAt,
      },
    });

    await prisma.progressSnapshot.create({
      data: {
        testFileId: testFile.id,
        targetCount: file.targetCount,
        okCount: file.okCount,
        ngCount: file.ngCount,
        notRunCount: file.notRunCount,
        excludedCount: file.excludedCount,
        updatedBy: nakamura.id,
        createdAt: file.updatedAt,
      },
    });
  }

  console.log('Created 3 test files for 旧基幹システム保守');

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
