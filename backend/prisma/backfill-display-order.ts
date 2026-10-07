// =============================================================================
// 進行中プロジェクトのタブ表示順（project_members.display_order）のNULLを埋めるスクリプト
// =============================================================================
// 「進行中プロジェクトのメンバーは必ず表示順を持ち、終了済みはNULL」という前提（db-schema.md 2-3節）に
// 反して、以前のSeed・メンバー追加APIで作られた行がNULLのまま残っているDBを直すために使う。
//
// 使い方（backendディレクトリで実行。接続先は.envのDATABASE_URL）:
//   npm run db:backfill-display-order              … 書き込まず、対象と埋めたあとの並びを表示するだけ
//   npm run db:backfill-display-order -- --apply   … 実際に書き込む
//
// - 進行中プロジェクトのNULLの行だけを埋める。値の入っている行と、終了済みプロジェクトの行には触らない。
//   そのため、何度実行しても結果は変わらない（2回目以降は対象0件になる）。
// - 埋める順番は、一覧API（ProjectsService.findAll）が今返している並びと同じにする。
//   値のある行が先（昇順）、NULLの行はその後ろに作成日の新しい順で並んでいるので、
//   NULLの行に「そのユーザーの最大値+1」から順に番号を振れば、画面の見た目は変わらない。

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  // 読み取りから書き込みまでを1つのトランザクションにし、途中で別の更新が割り込んでも
  // 計算に使った状態とずれた番号を書き込まないようにする
  await prisma.$transaction(async (tx) => {
    const memberships = await tx.projectMember.findMany({
      where: { project: { status: 'active' } },
      select: {
        id: true,
        userId: true,
        displayOrder: true,
        user: { select: { email: true } },
        project: { select: { name: true } },
      },
      // 一覧APIと同じ並び。作成日が同じ場合に実行ごとの結果がぶれないよう、最後にプロジェクトIDを足す
      orderBy: [
        { userId: 'asc' },
        { displayOrder: { sort: 'asc', nulls: 'last' } },
        { project: { createdAt: 'desc' } },
        { projectId: 'asc' },
      ],
    });

    const byUser = new Map<string, typeof memberships>();
    for (const m of memberships) {
      byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m]);
    }

    const updates: { id: string; displayOrder: number }[] = [];

    for (const rows of byUser.values()) {
      if (rows.every((r) => r.displayOrder !== null)) continue;

      // プロジェクト作成・メンバー追加と同じく、進行中プロジェクトの最大値+1から振る
      let next = Math.max(-1, ...rows.map((r) => r.displayOrder ?? -1)) + 1;

      console.log(`\n${rows[0].user.email}`);
      for (const r of rows) {
        const after = r.displayOrder ?? next++;
        if (r.displayOrder === null) {
          updates.push({ id: r.id, displayOrder: after });
        }
        const mark = r.displayOrder === null ? '（null → 埋める）' : '';
        console.log(`  ${after}: ${r.project.name}${mark}`);
      }
    }

    console.log(`\n埋める対象: ${updates.length}行`);

    if (!apply) {
      console.log(
        '確認のみで終了しました（書き込むには --apply を付けて実行）。',
      );
      return;
    }

    for (const u of updates) {
      await tx.projectMember.update({
        where: { id: u.id },
        data: { displayOrder: u.displayOrder },
      });
    }
    console.log(`${updates.length}行を更新しました。`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
