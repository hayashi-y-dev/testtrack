import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers/test-app.js';

const SUCCESS_MESSAGE =
  '登録されているメールアドレスの場合、再設定用メールを送信しました。';
const FROM_ADDRESS = 'sender@example.com';
const FRONTEND_URL = 'https://testtrack.example.com';

// パスワード再設定メールの本番送信（Amazon SES）。実際のSESには接続せず、送信処理をモックにする
describe('パスワード再設定メールの送信 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let user: TestUser;
  let sendSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  // ログにURL・トークンが出ていないかを確認するため、出力経路をまとめて記録する
  let logSpies: ReturnType<typeof vi.spyOn>[];

  const requestReset = (email: string): request.Test =>
    request(app.getHttpServer())
      .post('/auth/password-reset-request')
      .send({ email });

  const expectSuccessResponse = (res: request.Response): void => {
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: SUCCESS_MESSAGE });
  };

  // 送信はレスポンスを返した後に非同期で進むため、成功・失敗いずれかのログが出るまで待つ
  const waitForMailSettled = (): Promise<void> =>
    vi.waitFor(() => {
      expect(
        infoSpy.mock.calls.length + errorSpy.mock.calls.length,
      ).toBeGreaterThan(0);
    });

  const sentInput = (): SendEmailCommandInput => {
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0] as SendEmailCommand;
    return command.input;
  };

  const sentBody = (): string =>
    sentInput().Content?.Simple?.Body?.Text?.Data ?? '';

  const allLogOutput = (): string =>
    logSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');

  // 再設定URLそのもの、およびトークン（32バイトの16進文字列）がログに含まれないこと
  const expectNoSecretsInLogs = (): void => {
    const output = allLogOutput();
    expect(output).not.toContain(FRONTEND_URL);
    expect(output).not.toContain('/password-reset/');
    expect(output).not.toMatch(/[0-9a-f]{64}/);
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    user = await createTestUser(prisma, 'mail');
  });

  afterAll(async () => {
    await deleteTestUsers(prisma, [user.userId]);
    await app.close();
  });

  beforeEach(() => {
    // アプリ起動（セッションCookieの設定）後に切り替えるため、本番モードになるのは再設定メールの分岐だけ
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SES_FROM_ADDRESS', FROM_ADDRESS);
    vi.stubEnv('FRONTEND_URL', FRONTEND_URL);

    sendSpy = vi
      .spyOn(SESv2Client.prototype, 'send')
      .mockResolvedValue({ MessageId: 'test-message-id' } as never);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    infoSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    logSpies = [
      errorSpy,
      infoSpy,
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('本番モード', () => {
    it('宛先・送信元・件名・本文が正しいメールをSESで送信する', async () => {
      const res = await requestReset(user.email);
      await waitForMailSettled();

      expectSuccessResponse(res);
      const input = sentInput();
      expect(input.FromEmailAddress).toBe(FROM_ADDRESS);
      expect(input.Destination?.ToAddresses).toEqual([user.email]);
      expect(input.Content?.Simple?.Subject?.Data).toBe(
        '【TestTrack】パスワード再設定のご案内',
      );

      const body = sentBody();
      const lines = body.split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe('パスワード再設定のご依頼を受け付けました。');
      expect(lines[1]).toBe(
        '下のURLから、30分以内にパスワードを再設定してください。',
      );
      expect(lines[2]).toMatch(
        new RegExp(`^${FRONTEND_URL}/password-reset/[0-9a-f]{64}$`),
      );
      expect(lines[3]).toBe(
        'このメールに心当たりがない場合は、何もせずこのメールを破棄してください。',
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('東京リージョンのSESへ送信する', async () => {
      await requestReset(user.email);
      await waitForMailSettled();

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const client = sendSpy.mock.contexts[0] as SESv2Client;
      expect(await client.config.region()).toBe('ap-northeast-1');
    });

    it('メール本文のURLに含まれるトークンで、再設定リンクを開ける', async () => {
      await requestReset(user.email);
      await waitForMailSettled();

      const token = new URL(sentBody().split('\n')[2]).pathname
        .split('/')
        .pop();
      const res = await request(app.getHttpServer())
        .post('/auth/password-reset-token/verify')
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: true });
    });

    it('SESに拒否されても成功を返し、宛先と理由をエラーログに残す', async () => {
      const rejected = new Error('Email address is not verified.');
      rejected.name = 'MessageRejected';
      sendSpy.mockRejectedValue(rejected);

      const res = await requestReset(user.email);
      await waitForMailSettled();

      expectSuccessResponse(res);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const message = String(errorSpy.mock.calls[0][0]);
      expect(message).toContain(user.email);
      expect(message).toContain(
        'MessageRejected: Email address is not verified.',
      );
    });

    it('送信元が未設定ならSESを呼ばずに成功を返し、宛先と理由をエラーログに残す', async () => {
      vi.stubEnv('SES_FROM_ADDRESS', undefined);

      const res = await requestReset(user.email);
      await waitForMailSettled();

      expectSuccessResponse(res);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const message = String(errorSpy.mock.calls[0][0]);
      expect(message).toContain(user.email);
      expect(message).toContain('SES_FROM_ADDRESS');
    });

    it.each([
      ['送信成功時', () => {}],
      [
        'SESに拒否された時',
        () => sendSpy.mockRejectedValue(new Error('rejected')),
      ],
      ['送信元が未設定の時', () => vi.stubEnv('SES_FROM_ADDRESS', undefined)],
    ])('%s、ログに再設定URL・トークンを出さない', async (_, arrange) => {
      arrange();

      await requestReset(user.email);
      await waitForMailSettled();

      expectNoSecretsInLogs();
    });

    it('メール送信の完了を待たずに成功レスポンスを返す', async () => {
      let finishSend!: () => void;
      sendSpy.mockReturnValue(
        new Promise((resolve) => {
          finishSend = () => resolve({ MessageId: 'test-message-id' });
        }) as never,
      );

      const res = await requestReset(user.email);

      expectSuccessResponse(res);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).not.toHaveBeenCalled();

      finishSend();
      await waitForMailSettled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('送信処理で想定外の例外が起きても、未処理のPromise拒否にせずエラーログに残す', async () => {
      const unhandledRejection = vi.fn();
      process.on('unhandledRejection', unhandledRejection);
      // Errorではない値が同期的に投げられる、想定外のケース
      sendSpy.mockImplementation(() => {
        throw 'unexpected failure';
      });

      try {
        const res = await requestReset(user.email);
        await waitForMailSettled();
        // unhandledRejectionは、Promiseの処理が一巡した後に発火するため1周待つ
        await new Promise((resolve) => setImmediate(resolve));

        expectSuccessResponse(res);
        expect(unhandledRejection).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const message = String(errorSpy.mock.calls[0][0]);
        expect(message).toContain(user.email);
        expect(message).toContain('unexpected failure');
      } finally {
        process.off('unhandledRejection', unhandledRejection);
      }
    });

    it('未登録のメールアドレスにはSESで送信せず、同じ成功メッセージを返す', async () => {
      const res = await requestReset('e2e-not-registered@example.com');

      expectSuccessResponse(res);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('開発モード', () => {
    it('SESで送信せず、コンソールに再設定URLを出力する', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      const res = await requestReset(user.email);

      expectSuccessResponse(res);
      await vi.waitFor(() => {
        expect(allLogOutput()).toMatch(
          new RegExp(`${FRONTEND_URL}/password-reset/[0-9a-f]{64}`),
        );
      });
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });
});
