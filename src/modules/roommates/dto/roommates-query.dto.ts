import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const SORT_OPTIONS = ['best_match', 'budget', 'move_in_soon', 'verified'] as const;

export class RoommatesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: SORT_OPTIONS, default: 'best_match' })
  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: (typeof SORT_OPTIONS)[number] = 'best_match';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  minBudget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxBudget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;
}
