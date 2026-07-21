import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { FeedCategory } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class FeedQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: FeedCategory })
  @IsOptional()
  @IsEnum(FeedCategory)
  category?: FeedCategory;

  @ApiPropertyOptional({
    description: 'Whether to sort by trending posts (true/false)',
  })
  @IsOptional()
  @IsBooleanString()
  @Type(() => String)
  trending?: string;

  @ApiPropertyOptional({
    description:
      'City to scope the feed (guests and city picker). Falls back to profile city when omitted.',
  })
  @IsOptional()
  @IsString()
  city?: string;
}
