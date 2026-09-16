import {
  IsArray,
  ValidateNested,
  IsUUID,
  IsInt,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrderItem {
  @IsUUID('4', { message: 'プロジェクトIDの形式が正しくありません。' })
  projectId: string;

  @IsInt({ message: '並び順は整数で指定してください。' })
  @Min(0, { message: '並び順は0以上で指定してください。' })
  order: number;
}

export class UpdateOrderDto {
  @IsArray({ message: 'ordersは配列で指定してください。' })
  @ArrayMinSize(1, { message: 'ordersには1件以上の項目が必要です。' })
  @ValidateNested({ each: true })
  @Type(() => OrderItem)
  orders: OrderItem[];
}
