import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { StoryMediaType, StoryCategory } from '@prisma/client';

export class CreateStoryDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ enum: StoryMediaType })
  @IsEnum(StoryMediaType)
  mediaType: StoryMediaType;

  @ApiProperty({ enum: StoryCategory })
  @IsEnum(StoryCategory)
  category: StoryCategory;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  details?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 300 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  durationSeconds?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}
