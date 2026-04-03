import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { FeedCategory } from '@prisma/client';

export class CreateFeedPostDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiProperty({ enum: FeedCategory })
  @IsEnum(FeedCategory)
  category: FeedCategory;

  @ApiPropertyOptional({
    description:
      'Tags as array or comma-separated string (e.g. "housing, transit")',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
    if (Array.isArray(value)) {
      return value
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .filter((v) => typeof v === 'string' && v.length > 0);
    }
    return [];
  })
  tags?: string[];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceLabel?: string;
}

