import {
  BadRequestException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import type { Observable } from 'rxjs';

// アップロードの上限。1回の送信の合計（10MB）は、手前のNext.jsの転送の既定値で決まる
export const MAX_UPLOAD_FILES = 20;
export const MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024;

export const TOO_MANY_FILES_MESSAGE = `一度に読み込めるファイルは${MAX_UPLOAD_FILES}件までです。`;
export const FILE_TOO_LARGE_MESSAGE =
  '1ファイルのサイズは5MBまでです。5MBを超えるファイルが含まれています。';
const UNREADABLE_UPLOAD_MESSAGE = '送信されたファイルを読み取れませんでした。';

/**
 * Excel読込のプレビューで、アップロードされたファイルを受け取る。Nest標準の FilesInterceptor は上限超えを英語の文言にするため、
 * multer のエラーの種類を見て、何がどう超えたか分かる日本語の400にする
 */
@Injectable()
export class TestFilesUploadInterceptor implements NestInterceptor {
  // 保存先を指定しないため、ファイルはメモリに置かれる（Excelの原本は保存しない）。
  // 5MBを超えたファイルはその時点で受け取りをやめ、残りは読み捨てるので、メモリに溜まらない
  private readonly upload = multer({
    limits: { fileSize: MAX_UPLOAD_FILE_SIZE, files: MAX_UPLOAD_FILES },
    // ブラウザは日本語のファイル名をUTF-8のまま送るため、utf8として読む（multerの既定はlatin1で文字化けする）
    defParamCharset: 'utf8',
  }).array('files', MAX_UPLOAD_FILES);

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    await new Promise<void>((resolve, reject) => {
      this.upload(http.getRequest<Request>(), http.getResponse<Response>(), (err: unknown) => {
        if (err) {
          reject(toUploadException(err));
          return;
        }
        resolve();
      });
    });
    return next.handle();
  }
}

function toUploadException(err: unknown): unknown {
  if (!(err instanceof MulterError)) {
    return err;
  }
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new BadRequestException(FILE_TOO_LARGE_MESSAGE);
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      // 件数の上限は、limits.files と array の最大件数のどちらかで先に検出される
      return new BadRequestException(TOO_MANY_FILES_MESSAGE);
    default:
      return new BadRequestException(UNREADABLE_UPLOAD_MESSAGE);
  }
}
