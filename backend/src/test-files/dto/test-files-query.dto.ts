import { IsOptional, IsIn, IsString } from 'class-validator';

export class TestFilesQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['all', 'hasIncomplete', 'allComplete'], {
    message: 'statusはall、hasIncomplete、allCompleteのいずれかで指定してください。',
  })
  status?: string;

  @IsOptional()
  @IsIn(['name', 'progress', 'updatedAt'], {
    message: 'sortはname、progress、updatedAtのいずれかで指定してください。',
  })
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'], {
    message: 'orderはasc、descのいずれかで指定してください。',
  })
  order?: string;

  @IsOptional()
  @IsIn(['5', '10', 'all'], {
    message: 'limitは5、10、allのいずれかで指定してください。',
  })
  limit?: string;
}
