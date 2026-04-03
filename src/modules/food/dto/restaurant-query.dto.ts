import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PriceRange } from '@prisma/client';

const SORT_OPTIONS = ['rating', 'distance', 'newest'] as const;

export class RestaurantQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiPropertyOptional({ enum: PriceRange })
  @IsOptional()
  @IsEnum(PriceRange)
  priceRange?: PriceRange;

  @ApiPropertyOptional({ description: 'e.g. Dine-in, Takeout, Delivery' })
  @IsOptional()
  @IsString()
  service?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: SORT_OPTIONS, default: 'newest' })
  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: (typeof SORT_OPTIONS)[number] = 'newest';
}
