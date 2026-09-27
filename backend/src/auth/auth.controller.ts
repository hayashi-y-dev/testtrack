import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import {
  PasswordResetRequestDto,
  VerifyTokenDto,
  PasswordResetDto,
} from './dto/password-reset.dto.js';
import { AuthGuard } from './guards/auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<{ id: string; email: string; displayName: string }> {
    const user = await this.authService.login(dto);

    // セッションにユーザーIDを保存
    req.session.userId = user.id;

    return user;
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
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

  @Post('password-reset-request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
  ): Promise<{ message: string }> {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('password-reset-token/verify')
  @HttpCode(HttpStatus.OK)
  async verifyToken(@Body() dto: VerifyTokenDto): Promise<{ valid: boolean }> {
    return this.authService.verifyToken(dto);
  }

  @Post('password-reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: PasswordResetDto,
  ): Promise<{ message: string }> {
    return this.authService.resetPassword(dto);
  }
}
