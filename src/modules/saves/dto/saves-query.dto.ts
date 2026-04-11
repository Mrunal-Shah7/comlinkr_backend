import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const SAVE_TYPES = [
  'news',
  'events',
  'listings',
  'food',
  'community',
  'stories',
  'roommates',
] as const;

export type SaveTypeParam = (typeof SAVE_TYPES)[number];

export class SavesQueryDto {
  @ApiPropertyOptional({
    enum: SAVE_TYPES,
    description: 'When set, returns paginated saved items for that type only.',
  })
  @IsOptional()
  @IsIn([...SAVE_TYPES])
  type?: SaveTypeParam;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
