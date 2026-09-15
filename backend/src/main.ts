import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // セッションストア設定（PostgreSQL）
  const PgSession = connectPgSimple(session);

  // DATABASE_URLからPostgreSQL接続情報を取得
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // セッションシークレットの検証
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }

  // 本番環境判定
  const isProduction = process.env.NODE_ENV === 'production';

  // バリデーションパイプを設定
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // セッションミドルウェアを設定
  app.use(
    session({
      store: new PgSession({
        conString: databaseUrl,
        tableName: 'session',
        createTableIfMissing: false,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24時間
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
