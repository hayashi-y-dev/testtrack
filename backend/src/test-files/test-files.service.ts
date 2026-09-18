import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TestFilesQueryDto } from './dto/test-files-query.dto.js';
import type { TestFileListItem, TestFileStatus } from './test-files.types.js';

@Injectable()
export class TestFilesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    userId: string,
    projectId: string,
    query: TestFilesQueryDto,
  ): Promise<{ files: TestFileListItem[]; totalCount: number }> {
    // プロジェクトへの参加を確認（全ロールアクセス可）
    await this.requireMembership(userId, projectId);

    // デフォルト値の設定
    const status = query.status ?? 'all';
    const sort = query.sort ?? 'progress';
    const order = query.order ?? 'asc';
    const limit = query.limit ?? '5';
    const searchQuery = query.q?.trim() ?? '';

    // テストファイルを取得
    const testFiles = await this.prisma.testFile.findMany({
      where: {
        projectId,
        ...(searchQuery && {
          name: { contains: searchQuery, mode: 'insensitive' },
        }),
      },
      include: {
        updatedBy: {
          select: { displayName: true },
        },
      },
    });

    // statusを算出してマッピング
    let files: TestFileListItem[] = testFiles.map((f) => {
      const fileStatus = this.calculateStatus(f.targetCount, f.notRunCount);
      const progressRate = this.calculateProgressRate(
        f.targetCount,
        f.okCount,
        f.ngCount,
      );

      return {
        id: f.id,
        fileName: f.name,
        progressRate,
        status: fileStatus,
        updatedAt: f.updatedAt,
        lastUpdatedBy: f.updatedBy.displayName,
      };
    });

    // statusでフィルタリング
    if (status !== 'all') {
      files = files.filter((f) => f.status === status);
    }

    // totalCountは表示件数で絞る前の件数
    const totalCount = files.length;

    // ソート
    files = this.sortFiles(files, sort, order);

    // 表示件数で絞る
    if (limit !== 'all') {
      const limitNum = parseInt(limit, 10);
      files = files.slice(0, limitNum);
    }

    return { files, totalCount };
  }

  private calculateStatus(
    targetCount: number,
    notRunCount: number,
  ): TestFileStatus {
    if (targetCount === 0) {
      return 'notApplicable';
    }
    if (notRunCount > 0) {
      return 'hasIncomplete';
    }
    return 'allComplete';
  }

  private calculateProgressRate(
    targetCount: number,
    okCount: number,
    ngCount: number,
  ): number | null {
    if (targetCount === 0) {
      return null;
    }
    const completedCount = okCount + ngCount;
    return Math.round((completedCount / targetCount) * 1000) / 10;
  }

  private sortFiles(
    files: TestFileListItem[],
    sort: string,
    order: string,
  ): TestFileListItem[] {
    const direction = order === 'asc' ? 1 : -1;

    return [...files].sort((a, b) => {
      let comparison = 0;

      switch (sort) {
        case 'name':
          comparison = a.fileName.localeCompare(b.fileName, 'ja');
          break;
        case 'progress':
          // nullは最後に配置（ascなら最後、descなら最初）
          if (a.progressRate === null && b.progressRate === null) {
            comparison = 0;
          } else if (a.progressRate === null) {
            comparison = 1;
          } else if (b.progressRate === null) {
            comparison = -1;
          } else {
            comparison = a.progressRate - b.progressRate;
          }
          break;
        case 'updatedAt':
          comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
          break;
      }

      // 第2ソートキー: ファイル名の自然順
      if (comparison === 0) {
        comparison = a.fileName.localeCompare(b.fileName, 'ja');
      }

      return comparison * direction;
    });
  }

  /**
   * プロジェクトへの参加を確認（全ロールアクセス可）
   */
  private async requireMembership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('指定されたプロジェクトが見つかりません。');
    }
  }
}
