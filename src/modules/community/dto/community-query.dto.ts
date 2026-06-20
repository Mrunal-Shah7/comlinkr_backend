import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { CommunityQuestionCategory } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CommunityQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      "City to scope questions (same as community stats / feed). Defaults to the user's saved location when omitted.",
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ enum: CommunityQuestionCategory })
  @IsOptional()
  @IsEnum(CommunityQuestionCategory)
  category?: CommunityQuestionCategory;

  @ApiPropertyOptional({
    description: 'Sort mode: recent (default) or trending',
    enum: ['recent', 'trending'],
    default: 'recent',
  })
  @IsOptional()
  @IsIn(['recent', 'trending'])
  @Type(() => String)
  sort?: string;
}
