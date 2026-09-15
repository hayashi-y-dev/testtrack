import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const user = await this.authService.login(dto);

    // セッションにユーザーIDを保存
    req.session.userId = user.id;

    return user;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    // 未ログイン状態のチェック
    if (!req.session.userId) {
      throw new UnauthorizedException('ログインが必要です。');
    }

    // session.destroy()はコールバック形式のため、Promiseでラップ
    try {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch {
      throw new InternalServerErrorException('ログアウトに失敗しました。');
    }

    // セッションCookieを失効させる
    res.clearCookie('connect.sid');
    return res.json({ message: 'ログアウトしました。' });
  }
}
