import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcrypt';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { PasswordResetToken } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import {
  PasswordResetRequestDto,
  VerifyTokenDto,
  PasswordResetDto,
} from './dto/password-reset.dto.js';

// タイミング攻撃対策用のダミーハッシュ（コスト値10、正しいbcrypt形式）
const DUMMY_HASH =
  '$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY_MINUTES = 30;

const INVALID_TOKEN_MESSAGE =
  'このリンクは利用できません。有効期限が切れているか、すでに使用されています。';

const SES_REGION = 'ap-northeast-1';
const PASSWORD_RESET_MAIL_SUBJECT = '【TestTrack】パスワード再設定のご案内';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // 認証情報は指定せず、EC2のIAMロールからSDKに自動で取得させる
  private readonly sesClient = new SESv2Client({ region: SES_REGION });

  constructor(private readonly prisma: PrismaService) {}

  async login(
    dto: LoginDto,
  ): Promise<{ id: string; email: string; displayName: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // タイミング攻撃対策: ユーザーが存在しない場合もダミーハッシュで照合を行い、
    // 処理時間の差からユーザーの存在を推測されないようにする
    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException(
        'メールアドレスまたはパスワードが正しくありません。',
      );
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
  }

  async getCurrentUser(
    userId: string,
  ): Promise<{ id: string; email: string; displayName: string }> {
    // 返すのは、ログイン（1-1）の成功時と同じ3項目（api-design.md 1-6）
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true },
    });

    // セッションは有効でも、ユーザーがいない場合（DBを直接操作して削除した場合など）は、
    // 未ログインと同じ扱いにする。MVPにユーザー削除の機能はないため、通常は起きない
    if (!user) {
      throw new UnauthorizedException('ログインが必要です。');
    }

    return user;
  }

  async requestPasswordReset(
    dto: PasswordResetRequestDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // 登録有無に関わらず同じレスポンスを返すため、ユーザーが存在しない場合も
    // エラーを投げずに正常終了する
    if (user) {
      // 同一ユーザーの未使用トークンを削除（都度クリア方式）
      await this.prisma.passwordResetToken.deleteMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
      });

      // 生トークンを生成
      const rawToken = randomBytes(32).toString('hex');

      // SHA-256でハッシュ化してDBに保存
      const hashedToken = this.hashToken(rawToken);

      // 有効期限を設定（30分後）
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: hashedToken,
          expiresAt,
        },
      });

      // メール送信（開発環境はログ出力、本番環境はSES）。
      // 失敗しても成功レスポンスを返し、失敗はサーバーログにだけ残す（再設定URL・トークンはログに出さない）。
      // 失敗時だけエラーを返すと、応答の違いからメールアドレスが登録済みだと推測できてしまうため。
      // 同じ理由で送信完了も待たない。待つと、登録済みの場合だけ応答が遅くなるため。
      void this.sendPasswordResetEmail(user.email, rawToken).catch(
        (error: unknown) => this.logPasswordResetEmailError(user.email, error),
      );
    }

    return {
      message:
        '登録されているメールアドレスの場合、再設定用メールを送信しました。',
    };
  }

  async verifyToken(dto: VerifyTokenDto): Promise<{ valid: boolean }> {
    const tokenRecord = await this.findValidToken(dto.token);

    if (!tokenRecord) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    return { valid: true };
  }

  async resetPassword(dto: PasswordResetDto): Promise<{ message: string }> {
    // 確認用パスワードとの一致チェック
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException(['確認用パスワードと一致しません。']);
    }

    const tokenRecord = await this.findValidToken(dto.token);

    if (!tokenRecord) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    // パスワードをbcryptでハッシュ化
    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

    // トランザクションでパスワード更新とトークン無効化を実行
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'パスワードを変更しました。' };
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private async findValidToken(
    rawToken: string,
  ): Promise<PasswordResetToken | null> {
    const hashedToken = this.hashToken(rawToken);

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token: hashedToken },
    });

    // トークンが存在しない、使用済み、期限切れの場合はnullを返す
    if (!tokenRecord) {
      return null;
    }

    if (tokenRecord.usedAt !== null) {
      return null;
    }

    if (tokenRecord.expiresAt < new Date()) {
      return null;
    }

    return tokenRecord;
  }

  private async sendPasswordResetEmail(
    email: string,
    rawToken: string,
  ): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production';
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    // フロントの再設定画面（/password-reset/[token]）に合わせ、トークンはパスに入れる。
    // トークンは16進数の文字だけなので、エンコードせずにそのままURLに入れられる
    const resetUrl = `${frontendUrl}/password-reset/${rawToken}`;

    if (isProduction) {
      await this.sendPasswordResetEmailViaSes(email, resetUrl);
    } else {
      // 開発環境: コンソールにURL出力
      console.log('========================================');
      console.log('[開発環境] パスワード再設定URL:');
      console.log(resetUrl);
      console.log('========================================');
    }
  }

  private async sendPasswordResetEmailViaSes(
    email: string,
    resetUrl: string,
  ): Promise<void> {
    const fromAddress = process.env.SES_FROM_ADDRESS;
    if (!fromAddress) {
      throw new Error('環境変数SES_FROM_ADDRESSが未設定です');
    }

    const body = [
      'パスワード再設定のご依頼を受け付けました。',
      `下のURLから、${TOKEN_EXPIRY_MINUTES}分以内にパスワードを再設定してください。`,
      resetUrl,
      'このメールに心当たりがない場合は、何もせずこのメールを破棄してください。',
    ].join('\n');

    const result = await this.sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: PASSWORD_RESET_MAIL_SUBJECT, Charset: 'UTF-8' },
            Body: { Text: { Data: body, Charset: 'UTF-8' } },
          },
        },
      }),
    );
    this.logger.log(
      `パスワード再設定メールを送信しました（宛先: ${email}、MessageId: ${result.MessageId}）`,
    );
  }

  private logPasswordResetEmailError(email: string, error: unknown): void {
    const reason =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    this.logger.error(
      `パスワード再設定メールを送信できませんでした（宛先: ${email}）: ${reason}`,
    );
  }
}
