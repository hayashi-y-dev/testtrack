import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import 'multer';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExcelParserService } from './excel-parser.service.js';
import { TestFilesQueryDto } from './dto/test-files-query.dto.js';
import { CommitFilesDto } from './dto/commit-files.dto.js';
import type {
  TestFileListItem,
  TestFileStatus,
  PreviewFileResult,
  PreviewResponse,
  CommitFileResult,
  CommitResponse,
} from './test-files.types.js';

@Injectable()
export class TestFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excelParser: ExcelParserService,
  ) {}

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
   * Excelを解析し、確認画面用の結果（新規／更新／エラー）を返す。DBには保存しない
   */
  async preview(
    userId: string,
    projectId: string,
    files: Express.Multer.File[],
  ): Promise<PreviewResponse> {
    // 権限チェック（テスター・管理者のみ）
    await this.requireTesterOrAdmin(userId, projectId);

    // 既存ファイル一覧を取得
    const existingFiles = await this.prisma.testFile.findMany({
      where: { projectId },
      select: { id: true, name: true, version: true, targetCount: true, okCount: true, ngCount: true },
    });
    const existingFileMap = new Map(existingFiles.map((f) => [f.name, f]));

    const results: PreviewFileResult[] = [];

    for (const file of files) {
      const parseResult = this.excelParser.parseExcel(file.buffer, file.originalname);

      if (!parseResult.success) {
        results.push({
          fileName: file.originalname,
          operation: 'error',
          errorMessage: parseResult.errorMessage,
        });
        continue;
      }

      const parsedData = parseResult.data!;
      const newProgressRate = this.excelParser.calculateProgressRate(parsedData);
      const existingFile = existingFileMap.get(file.originalname);

      if (existingFile) {
        const currentProgressRate = this.calculateProgressRate(
          existingFile.targetCount,
          existingFile.okCount,
          existingFile.ngCount,
        );
        results.push({
          fileName: file.originalname,
          operation: 'update',
          existingFileId: existingFile.id,
          baseVersion: existingFile.version,
          currentProgressRate,
          newProgressRate,
          parsedData,
        });
      } else {
        results.push({
          fileName: file.originalname,
          operation: 'create',
          newProgressRate,
          parsedData,
        });
      }
    }

    const successCount = results.filter((r) => r.operation !== 'error').length;
    const errorCount = results.filter((r) => r.operation === 'error').length;

    // 全ファイルがエラーの場合は400
    if (successCount === 0 && errorCount > 0) {
      throw new BadRequestException('すべてのファイルがエラーのため読み込めません。');
    }

    return {
      files: results,
      summary: {
        totalCount: results.length,
        errorCount,
        successCount,
      },
    };
  }

  /**
   * 確認済みの解析結果をDBに登録・更新する。更新時は楽観ロックで競合を検出し、
   * エラーはファイル単位で返す（全件エラーでも400にはしない）
   */
  async commit(
    userId: string,
    projectId: string,
    dto: CommitFilesDto,
  ): Promise<CommitResponse> {
    // 権限チェック（テスター・管理者のみ）
    await this.requireTesterOrAdmin(userId, projectId);

    const results: CommitFileResult[] = [];

    for (const file of dto.files) {
      try {
        if (file.operation === 'create') {
          const newFile = await this.prisma.testFile.create({
            data: {
              projectId,
              name: file.fileName,
              targetCount: file.parsedData.targetCount,
              okCount: file.parsedData.okCount,
              ngCount: file.parsedData.ngCount,
              notRunCount: file.parsedData.notRunCount,
              excludedCount: file.parsedData.excludedCount,
              lastUpdatedBy: userId,
            },
          });

          // 初回登録時もProgressSnapshotを作成
          await this.prisma.progressSnapshot.create({
            data: {
              testFileId: newFile.id,
              targetCount: file.parsedData.targetCount,
              okCount: file.parsedData.okCount,
              ngCount: file.parsedData.ngCount,
              notRunCount: file.parsedData.notRunCount,
              excludedCount: file.parsedData.excludedCount,
              updatedBy: userId,
            },
          });

          results.push({
            fileName: file.fileName,
            result: 'success',
            operation: 'create',
            fileId: newFile.id,
          });
        } else {
          // update
          const existingFile = await this.prisma.testFile.findUnique({
            where: { id: file.existingFileId },
            select: { version: true, projectId: true },
          });

          // ファイルが存在しない、または別プロジェクトの場合
          if (!existingFile || existingFile.projectId !== projectId) {
            results.push({
              fileName: file.fileName,
              result: 'error',
              errorMessage: '指定されたファイルが見つかりません。',
            });
            continue;
          }

          // 楽観ロックチェック
          if (existingFile.version !== file.baseVersion) {
            results.push({
              fileName: file.fileName,
              result: 'error',
              errorMessage:
                'このファイルは確認後に別ユーザーによって更新されました。最新状態を確認して再度実行してください。',
            });
            continue;
          }

          // 更新
          const updatedFile = await this.prisma.testFile.update({
            where: { id: file.existingFileId },
            data: {
              targetCount: file.parsedData.targetCount,
              okCount: file.parsedData.okCount,
              ngCount: file.parsedData.ngCount,
              notRunCount: file.parsedData.notRunCount,
              excludedCount: file.parsedData.excludedCount,
              lastUpdatedBy: userId,
              version: { increment: 1 },
            },
          });

          // ProgressSnapshotを作成
          await this.prisma.progressSnapshot.create({
            data: {
              testFileId: updatedFile.id,
              targetCount: file.parsedData.targetCount,
              okCount: file.parsedData.okCount,
              ngCount: file.parsedData.ngCount,
              notRunCount: file.parsedData.notRunCount,
              excludedCount: file.parsedData.excludedCount,
              updatedBy: userId,
            },
          });

          results.push({
            fileName: file.fileName,
            result: 'success',
            operation: 'update',
            fileId: updatedFile.id,
          });
        }
      } catch {
        results.push({
          fileName: file.fileName,
          result: 'error',
          errorMessage: 'ファイルの処理中にエラーが発生しました。',
        });
      }
    }

    const successCount = results.filter((r) => r.result === 'success').length;
    const errorCount = results.filter((r) => r.result === 'error').length;

    return {
      files: results,
      summary: {
        totalCount: results.length,
        successCount,
        errorCount,
      },
    };
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

  /**
   * テスター・管理者のみアクセス可（閲覧者は403）
   */
  private async requireTesterOrAdmin(
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
      select: { role: true },
    });

    if (!membership) {
      throw new NotFoundException('指定されたプロジェクトが見つかりません。');
    }

    if (membership.role === 'viewer') {
      throw new ForbiddenException('この操作を行う権限がありません。');
    }
  }
}
