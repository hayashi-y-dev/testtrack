import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsNotEmpty({ message: 'メールアドレスは必須です。' })
  @IsEmail({}, { message: 'メールアドレスの形式が正しくありません。' })
  @MaxLength(255, { message: 'メールアドレスは255文字以内で入力してください。' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email: string;

  @IsNotEmpty({ message: 'パスワードは必須です。' })
  password: string;
}
