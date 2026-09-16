import { IsEmail, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class PasswordResetRequestDto {
  @IsNotEmpty({ message: 'メールアドレスは必須です。' })
  @IsEmail({}, { message: 'メールアドレスの形式が正しくありません。' })
  @MaxLength(255, { message: 'メールアドレスは255文字以内で入力してください。' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email: string;
}

export class VerifyTokenDto {
  @IsNotEmpty({ message: 'トークンは必須です。' })
  token: string;
}

export class PasswordResetDto {
  @IsNotEmpty({ message: 'トークンは必須です。' })
  token: string;

  @IsNotEmpty({ message: 'パスワードは必須です。' })
  @MinLength(15, { message: 'パスワードは15文字以上で入力してください。' })
  @MaxLength(64, { message: 'パスワードは64文字以内で入力してください。' })
  newPassword: string;

  @IsNotEmpty({ message: '確認用パスワードは必須です。' })
  confirmPassword: string;
}
