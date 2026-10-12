import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * 指定ユーザーの進行中プロジェクトタブの末尾に置くための並び順（既存最大値+1）を返す
 *
 * 「進行中プロジェクトのメンバーは必ずorderを持ち、終了済みはNULL」という前提を保つため、
 * 進行中プロジェクトへ参加する入口
 * （プロジェクト作成・メンバー追加）はすべてこの関数でorderを決める。
 * 終了済みプロジェクトのNULLは集計対象から外す。
 */
export async function nextDisplayOrder(
  prisma: PrismaService,
  userId: string,
): Promise<number> {
  const maxOrderResult = await prisma.projectMember.aggregate({
    where: {
      userId,
      project: { status: 'active' },
      displayOrder: { not: null },
    },
    _max: { displayOrder: true },
  });

  return (maxOrderResult._max.displayOrder ?? -1) + 1;
}
