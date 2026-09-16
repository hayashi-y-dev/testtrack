import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcrypt';
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

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: LoginDto) {
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

  async requestPasswordReset(dto: PasswordResetRequestDto) {
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

      // メール送信（開発環境はログ出力、本番環境はSES）
      await this.sendPasswordResetEmail(user.email, rawToken);
    }

    return {
      message:
        '登録されているメールアドレスの場合、再設定用メールを送信しました。',
    };
  }

  async verifyToken(dto: VerifyTokenDto) {
    const tokenRecord = await this.findValidToken(dto.token);

    if (!tokenRecord) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    return { valid: true };
  }

  async resetPassword(dto: PasswordResetDto) {
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

  private async findValidToken(rawToken: string) {
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
    const resetUrl = `${frontendUrl}/password-reset?token=${rawToken}`;

    if (isProduction) {
      // TODO: Amazon SESでメール送信（今回のスコープ外）
      // await this.sendEmailViaSes(email, resetUrl);
      console.log(`[SES] Sending password reset email to ${email}`);
    } else {
      // 開発環境: コンソールにURL出力
      console.log('========================================');
      console.log('[開発環境] パスワード再設定URL:');
      console.log(resetUrl);
      console.log('========================================');
    }
  }
}
