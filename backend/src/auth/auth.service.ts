import { Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';

// タイミング攻撃対策用のダミーハッシュ（コスト値10、正しいbcrypt形式）
const DUMMY_HASH =
  '$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

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
}
