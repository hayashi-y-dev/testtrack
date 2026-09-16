import { IsNotEmpty, MaxLength, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'プロジェクト名は必須です。' })
  @MinLength(1, { message: 'プロジェクト名は1文字以上で入力してください。' })
  @MaxLength(50, { message: 'プロジェクト名は50文字以内で入力してください。' })
  @Matches(/^[^\n\r]*$/, { message: 'プロジェクト名に改行を含めることはできません。' })
  name: string;
}
