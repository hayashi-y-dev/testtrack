import { IsIn } from 'class-validator';

export class ChangeRoleDto {
  @IsIn(['admin', 'tester', 'viewer'], {
    message: 'ロールはadmin、tester、viewerのいずれかで指定してください。',
  })
  role: string;
}
