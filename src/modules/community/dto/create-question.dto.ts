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
import { CommunityQuestionCategory } from '@prisma/client';

export class CreateQuestionDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @ApiProperty({ enum: CommunityQuestionCategory })
  @IsEnum(CommunityQuestionCategory)
  category: CommunityQuestionCategory;

  @ApiPropertyOptional({
    description:
      'Tags as array or comma-separated string (e.g. \"housing, transit\")',
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
}

