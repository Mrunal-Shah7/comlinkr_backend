import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';
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
}

