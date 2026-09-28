import {
  IsArray,
  IsDefined,
  ValidateNested,
  IsString,
  IsIn,
  IsUUID,
  IsInt,
  IsOptional,
  IsNumber,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

class ParsedDataDto {
  @IsInt()
  @Min(0)
  targetCount: number;

  @IsInt()
  @Min(0)
  okCount: number;

  @IsInt()
  @Min(0)
  ngCount: number;

  @IsInt()
  @Min(0)
  notRunCount: number;

  @IsInt()
  @Min(0)
  excludedCount: number;
}

class CommitFileDto {
  @IsString()
  fileName: string;

  @IsIn(['create', 'update'])
  operation: 'create' | 'update';

  @ValidateIf((o) => o.operation === 'update')
  @IsUUID('4')
  existingFileId?: string;

  @ValidateIf((o) => o.operation === 'update')
  @IsInt()
  @Min(1)
  baseVersion?: number;

  // @ValidateNestedは値がundefined/nullだと検証をスキップするため、必須チェックを別途付ける
  @IsDefined()
  @ValidateNested()
  @Type(() => ParsedDataDto)
  parsedData: ParsedDataDto;
}

export class CommitFilesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitFileDto)
  files: CommitFileDto[];
}
