import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestFixture,
  createTestApp,
  createTestFixture,
  type TestFixture,
} from './helpers/test-app.js';

const CONFLICT_MESSAGE =
  'このファイルは確認後に別ユーザーによって更新されました。最新状態を確認して再度実行してください。';
const NO_TEST_SHEET_MESSAGE =
  'テストケースシート（「No」列と結果列を持つシート）が見つかりませんでした。';

const PARSED_DATA = {
  targetCount: 4,
  okCount: 2,
  ngCount: 1,
  notRunCount: 1,
  excludedCount: 0,
};
const UPDATED_PARSED_DATA = { ...PARSED_DATA, okCount: 3, notRunCount: 0 };

// 同時実行の件数。修正前の実装ではこの規模で同じbaseVersionの更新が複数件成功していた
const PARALLEL_REQUESTS = 20;
// 同時更新の競合はタイミング次第で1ラウンドだと再現しないことがある（修正前の実装で
// 検出率は約7〜8割）ため、ラウンドを重ねて回帰を見逃す確率を下げる
const RACE_ROUNDS = 5;

interface CommitFileResult {
  fileName: string;
  result: 'success' | 'error';
  errorMessage?: string;
}

function toXlsxBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'テスト');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('テストファイルAPI (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: TestFixture;
  let agent: ReturnType<typeof request.agent>;
  let fileNameSeq = 0;

  const commitUrl = (): string =>
    `/projects/${fixture.projectId}/test-files/commit`;
  const previewUrl = (): string =>
    `/projects/${fixture.projectId}/test-files/preview`;
  const uniqueFileName = (): string => `e2e_${++fileNameSeq}.xlsx`;

  const countTestFiles = (name: string): Promise<number> =>
    prisma.testFile.count({ where: { projectId: fixture.projectId, name } });

  const createFileViaApi = async (name: string): Promise<string> => {
    const res = await agent
      .post(commitUrl())
      .send({
        files: [
          { fileName: name, operation: 'create', parsedData: PARSED_DATA },
        ],
      })
      .expect(200);
    return (res.body as { files: { fileId: string }[] }).files[0].fileId;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fixture = await createTestFixture(prisma);
    agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/login')
      .send({ email: fixture.email, password: fixture.password })
      .expect(200);
  });

  afterAll(async () => {
    await cleanupTestFixture(prisma, fixture);
    await app.close();
  });

  describe('POST /projects/:id/test-files/commit - parsedDataの必須チェック', () => {
    it('parsedDataがあれば200で登録される', async () => {
      const name = uniqueFileName();

      const res = await agent
        .post(commitUrl())
        .send({
          files: [
            { fileName: name, operation: 'create', parsedData: PARSED_DATA },
          ],
        })
        .expect(200);

      expect(res.body.files[0].result).toBe('success');
      expect(await countTestFiles(name)).toBe(1);
    });

    it.each([
      ['欠落している', {}],
      ['nullである', { parsedData: null }],
      ['オブジェクトでない', { parsedData: 'invalid' }],
    ])(
      'create時にparsedDataが%s場合は400になり、登録されない',
      async (_label, parsedDataField) => {
        const name = uniqueFileName();

        await agent
          .post(commitUrl())
          .send({
            files: [{ fileName: name, operation: 'create', ...parsedDataField }],
          })
          .expect(400);

        expect(await countTestFiles(name)).toBe(0);
      },
    );

    it('update時にparsedDataが欠落している場合は400になり、更新されない', async () => {
      const name = uniqueFileName();
      const fileId = await createFileViaApi(name);

      await agent
        .post(commitUrl())
        .send({
          files: [
            {
              fileName: name,
              operation: 'update',
              existingFileId: fileId,
              baseVersion: 1,
            },
          ],
        })
        .expect(400);

      const file = await prisma.testFile.findUniqueOrThrow({
        where: { id: fileId },
      });
      expect(file.version).toBe(1);
    });
  });

  describe('POST /projects/:id/test-files/commit - 同時実行時の整合性', () => {
    it(
      '同じbaseVersionの更新が同時に届いても成功は1件だけで、version・履歴に不整合が残らない',
      async () => {
        for (let round = 1; round <= RACE_ROUNDS; round++) {
          const name = uniqueFileName();
          const fileId = await createFileViaApi(name);
          const body = {
            files: [
              {
                fileName: name,
                operation: 'update',
                existingFileId: fileId,
                baseVersion: 1,
                parsedData: UPDATED_PARSED_DATA,
              },
            ],
          };

          const responses = await Promise.all(
            Array.from({ length: PARALLEL_REQUESTS }, () =>
              agent.post(commitUrl()).send(body),
            ),
          );

          const results = responses.map(
            (res) => (res.body as { files: CommitFileResult[] }).files[0],
          );
          expect(responses.every((res) => res.status === 200)).toBe(true);
          expect(
            results.filter((r) => r.result === 'success'),
            `ラウンド${round}の成功件数`,
          ).toHaveLength(1);
          expect(
            results
              .filter((r) => r.result === 'error')
              .every((r) => r.errorMessage === CONFLICT_MESSAGE),
          ).toBe(true);

          // 成功した1件分だけversionが進み、履歴も初回登録＋更新1件の2件だけになる
          const file = await prisma.testFile.findUniqueOrThrow({
            where: { id: fileId },
          });
          expect(file.version, `ラウンド${round}のversion`).toBe(2);
          expect(file.okCount).toBe(UPDATED_PARSED_DATA.okCount);
          expect(
            await prisma.progressSnapshot.count({
              where: { testFileId: fileId },
            }),
            `ラウンド${round}の履歴件数`,
          ).toBe(2);
        }
      },
      30_000,
    );

    it(
      '同名ファイルの新規登録が同時に届いても登録は1件だけで、残りは競合エラーになる',
      async () => {
        const name = uniqueFileName();
        const body = {
          files: [
            { fileName: name, operation: 'create', parsedData: PARSED_DATA },
          ],
        };

        const responses = await Promise.all(
          Array.from({ length: PARALLEL_REQUESTS }, () =>
            agent.post(commitUrl()).send(body),
          ),
        );

        const results = responses.map(
          (res) => (res.body as { files: CommitFileResult[] }).files[0],
        );
        expect(responses.every((res) => res.status === 200)).toBe(true);
        expect(results.filter((r) => r.result === 'success')).toHaveLength(1);
        // ユニーク制約違反は汎用エラーではなく、楽観ロック競合と同じ文言で返す（仕様8-1章）
        expect(
          results
            .filter((r) => r.result === 'error')
            .every((r) => r.errorMessage === CONFLICT_MESSAGE),
        ).toBe(true);

        // TestFileと初回登録の履歴が1件ずつだけ残る
        const files = await prisma.testFile.findMany({
          where: { projectId: fixture.projectId, name },
          include: { _count: { select: { snapshots: true } } },
        });
        expect(files).toHaveLength(1);
        expect(files[0]._count.snapshots).toBe(1);
      },
      20_000,
    );
  });

  describe('POST /projects/:id/test-files/preview - 結果列の判定', () => {
    it('「期待結果」列が実施状況列より左にあっても、実施状況列で集計される', async () => {
      const fileName = uniqueFileName();
      const buffer = toXlsxBuffer([
        ['No', '項目', '期待結果', '実施状況'],
        [1, 'a', 'ログインできること', 'OK'],
        [2, 'b', 'エラーが表示されること', 'OK'],
        [3, 'c', '画面遷移すること', 'NG'],
        [4, 'd', '保存されること', ''],
      ]);

      const res = await agent
        .post(previewUrl())
        .attach('files', buffer, fileName)
        .expect(200);

      // 期待結果列を読んでいた場合は、全件が未実施（okCount 0）として集計される
      expect(res.body.files[0]).toMatchObject({
        fileName,
        operation: 'create',
        newProgressRate: 75,
        parsedData: {
          targetCount: 4,
          okCount: 2,
          ngCount: 1,
          notRunCount: 1,
          excludedCount: 0,
        },
      });
    });

    it('「No」列と「期待結果」列だけのシートは、結果列がないため対象外になる', async () => {
      const expectedOnly = toXlsxBuffer([
        ['No', '項目', '期待結果'],
        [1, 'a', 'ログインできること'],
      ]);
      // 1ファイルだけだと全件エラーの400になりファイル別の理由が見えないため、正常ファイルと同時に送る
      const valid = toXlsxBuffer([
        ['No', '結果'],
        [1, 'OK'],
      ]);

      const res = await agent
        .post(previewUrl())
        .attach('files', expectedOnly, 'expected_only.xlsx')
        .attach('files', valid, uniqueFileName())
        .expect(200);

      expect(res.body.files[0]).toEqual({
        fileName: 'expected_only.xlsx',
        operation: 'error',
        errorMessage: NO_TEST_SHEET_MESSAGE,
      });
    });
  });
});
