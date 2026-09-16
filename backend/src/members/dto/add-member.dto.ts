import { IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsUUID('4', { message: 'ユーザーIDの形式が正しくありません。' })
  userId: string;
}
