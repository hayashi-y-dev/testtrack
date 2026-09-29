import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import 'multer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExcelParserService } from './excel-parser.service.js';
import { TestFilesQueryDto } from './dto/test-files-query.dto.js';
import { CommitFilesDto } from './dto/commit-files.dto.js';
import type {
  TestFileListItem,
  TestFileStatus,
  ParsedData,
  PreviewFileResult,
  PreviewResponse,
  CommitFileResult,
  CommitResponse,
} from './test-files.types.js';

type CommitFileInput = CommitFilesDto['files'][number];

const CONFLICT_MESSAGE =
  'このファイルは確認後に別ユーザーによって更新されました。最新状態を確認して再度実行してください。';
const FILE_NOT_FOUND_MESSAGE = '指定されたファイルが見つかりません。';
const COMMIT_FAILED_MESSAGE = 'ファイルの処理中にエラーが発生しました。';
const HAS_UPDATE_HISTORY_MESSAGE =
  'このファイルには更新履歴が存在するため、登録を取り消せません。';

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
      results.push(await this.commitFile(userId, projectId, file));
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
   * 1ファイル分の登録・更新を1トランザクションで行い、失敗はファイル単位のエラーとして返す
   */
  private async commitFile(
    userId: string,
    projectId: string,
    file: CommitFileInput,
  ): Promise<CommitFileResult> {
    try {
      return await this.prisma.$transaction((tx) =>
        file.operation === 'create'
          ? this.createTestFile(tx, userId, projectId, file)
          : this.updateTestFile(tx, userId, projectId, file),
      );
    } catch (error) {
      // 確認画面の表示後に別ユーザーが同名ファイルを登録していた場合（ユニーク制約違反）は、
      // 更新の競合と同じ「エラー」として扱う（仕様6-8章・8-1章）
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.commitErrorResult(file.fileName, CONFLICT_MESSAGE);
      }
      return this.commitErrorResult(file.fileName, COMMIT_FAILED_MESSAGE);
    }
  }

  /**
   * TestFileを新規登録し、初回登録の履歴を作成する
   */
  private async createTestFile(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
    file: CommitFileInput,
  ): Promise<CommitFileResult> {
    const newFile = await tx.testFile.create({
      data: {
        projectId,
        name: file.fileName,
        ...this.toCountData(file.parsedData),
        lastUpdatedBy: userId,
      },
    });
    await this.createSnapshot(tx, newFile.id, userId, file.parsedData);

    return {
      fileName: file.fileName,
      result: 'success',
      operation: 'create',
      fileId: newFile.id,
    };
  }

  /**
   * 楽観ロックでTestFileを更新し、更新履歴を作成する
   */
  private async updateTestFile(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
    file: CommitFileInput,
  ): Promise<CommitFileResult> {
    const fileId = file.existingFileId!;

    // versionの一致を更新条件に含め、確認と更新を1つのUPDATE文で行う。
    // 確認と更新を別クエリにすると、同時実行された2リクエストが両方とも成功しうるため
    const { count } = await tx.testFile.updateMany({
      where: { id: fileId, projectId, version: file.baseVersion },
      data: {
        ...this.toCountData(file.parsedData),
        lastUpdatedBy: userId,
        version: { increment: 1 },
      },
    });

    if (count === 0) {
      const exists = await tx.testFile.findFirst({
        where: { id: fileId, projectId },
        select: { id: true },
      });
      return this.commitErrorResult(
        file.fileName,
        exists ? CONFLICT_MESSAGE : FILE_NOT_FOUND_MESSAGE,
      );
    }

    await this.createSnapshot(tx, fileId, userId, file.parsedData);

    return {
      fileName: file.fileName,
      result: 'success',
      operation: 'update',
      fileId,
    };
  }

  /**
   * 進捗履歴（ProgressSnapshot）を作成
   */
  private async createSnapshot(
    tx: Prisma.TransactionClient,
    testFileId: string,
    userId: string,
    parsedData: ParsedData,
  ): Promise<void> {
    await tx.progressSnapshot.create({
      data: {
        testFileId,
        ...this.toCountData(parsedData),
        updatedBy: userId,
      },
    });
  }

  /**
   * 解析結果から集計値のカラムだけを取り出す
   */
  private toCountData(parsedData: ParsedData): ParsedData {
    return {
      targetCount: parsedData.targetCount,
      okCount: parsedData.okCount,
      ngCount: parsedData.ngCount,
      notRunCount: parsedData.notRunCount,
      excludedCount: parsedData.excludedCount,
    };
  }

  /**
   * コミット結果のエラー行を作成
   */
  private commitErrorResult(
    fileName: string,
    errorMessage: string,
  ): CommitFileResult {
    return { fileName, result: 'error', errorMessage };
  }

  /**
   * 初回登録のみのTestFileを、初回登録の履歴ごと削除する（登録取消）
   */
  async remove(
    userId: string,
    projectId: string,
    fileId: string,
  ): Promise<{ message: string }> {
    // 権限チェック（テスター・管理者のみ）
    await this.requireTesterOrAdmin(userId, projectId);

    // 判定→削除を別クエリにすると、その間に届いた更新を取りこぼして更新済みのファイルを消すため、
    // 取消可否を削除条件に含めて1文で行う。versionは更新のたびに履歴作成と同じトランザクションで
    // 加算されるので、version=1は「初回登録の履歴しかない」ことを意味する
    const { count } = await this.prisma.testFile.deleteMany({
      where: { id: fileId, projectId, version: 1 },
    });

    if (count === 0) {
      const exists = await this.prisma.testFile.findFirst({
        where: { id: fileId, projectId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(FILE_NOT_FOUND_MESSAGE);
      }
      throw new BadRequestException(HAS_UPDATE_HISTORY_MESSAGE);
    }

    return { message: '登録を取り消しました。' };
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
