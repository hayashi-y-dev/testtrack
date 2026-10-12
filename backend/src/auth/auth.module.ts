import { Module } from '@nestjs/common';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    // ログインのレート制限。クライアントIPごとに1分間5回まで。
    // ガードはログインにだけ付けるため、ここでの設定は他のAPIには効かない（auth.controller.ts）
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: seconds(60), limit: 5 }],
      errorMessage:
        'ログインの試行回数が上限に達しました。しばらくしてから、もう一度お試しください。',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
