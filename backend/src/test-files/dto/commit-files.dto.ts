import {
  IsArray,
  IsDefined,
  ValidateNested,
  IsString,
  IsIn,
  IsUUID,
  IsInt,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

class ParsedDataDto {
  @IsInt({ message: '対象件数は整数で指定してください。' })
  @Min(0, { message: '対象件数は0以上で指定してください。' })
  targetCount: number;

  @IsInt({ message: 'OK件数は整数で指定してください。' })
  @Min(0, { message: 'OK件数は0以上で指定してください。' })
  okCount: number;

  @IsInt({ message: 'NG件数は整数で指定してください。' })
  @Min(0, { message: 'NG件数は0以上で指定してください。' })
  ngCount: number;

  @IsInt({ message: '未実施件数は整数で指定してください。' })
  @Min(0, { message: '未実施件数は0以上で指定してください。' })
  notRunCount: number;

  @IsInt({ message: '対象外件数は整数で指定してください。' })
  @Min(0, { message: '対象外件数は0以上で指定してください。' })
  excludedCount: number;
}

class CommitFileDto {
  @IsString({ message: 'ファイル名は文字列で指定してください。' })
  fileName: string;

  @IsIn(['create', 'update'], {
    message: 'operationはcreate、updateのいずれかで指定してください。',
  })
  operation: 'create' | 'update';

  @ValidateIf((o) => o.operation === 'update')
  @IsUUID('4', { message: 'existingFileIdの形式が正しくありません。' })
  existingFileId?: string;

  @ValidateIf((o) => o.operation === 'update')
  @IsInt({ message: 'baseVersionは整数で指定してください。' })
  @Min(1, { message: 'baseVersionは1以上で指定してください。' })
  baseVersion?: number;

  // @ValidateNestedは値がundefined/nullだと検証をスキップするため、必須チェックを別途付ける
  @IsDefined({ message: 'parsedDataは必須です。' })
  @ValidateNested({ message: 'オブジェクト形式で指定してください。' })
  @Type(() => ParsedDataDto)
  parsedData: ParsedDataDto;
}

export class CommitFilesDto {
  @IsArray({ message: 'filesは配列で指定してください。' })
  @ValidateNested({
    each: true,
    message: '配列の要素はオブジェクト形式で指定してください。',
  })
  @Type(() => CommitFileDto)
  files: CommitFileDto[];
}
