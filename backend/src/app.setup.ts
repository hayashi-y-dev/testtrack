import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Application } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

/**
 * バリデーション・セッション等のアプリ共通設定を適用する。
 * 本番起動（main.ts）とe2eテストで同じ設定を使い、テストとの差異を生まないために切り出している
 */
export function setupApp(app: INestApplication): void {
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

  // 同じマシン上のプロキシ（Next.jsの転送）から来たリクエストに限り、X-Forwarded-* を信用する。
  // 本番はFunnel→Next.js→NestJSの順に転送され、NestJSへの接続自体はHTTPのため、信用しないと
  // HTTPSでのアクセスと判断できず、secure付きのセッションCookieが発行されない。
  // どこからでも信用する（true）と、外部から X-Forwarded-* を偽装できるため、ループバックだけに限る
  (app.getHttpAdapter().getInstance() as Application).set(
    'trust proxy',
    'loopback',
  );

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
}
