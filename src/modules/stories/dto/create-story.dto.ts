import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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

function parseHashtagsInput(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  if (Array.isArray(value)) {
    return value.map(String).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return undefined;
    if (t.startsWith('[')) {
      try {
        const j = JSON.parse(t) as unknown;
        if (Array.isArray(j)) {
          return j.map(String).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean);
        }
      } catch {
        return undefined;
      }
    }
    return t
      .split(/[,]+|\s+/)
      .map((s) => s.replace(/^#+/, '').trim())
      .filter(Boolean);
  }
  return undefined;
}

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

  @ApiPropertyOptional({
    type: [String],
    description:
      'JSON string array, comma-separated tags, or repeated form fields (multipart)',
  })
  @IsOptional()
  @Transform(({ value }) => parseHashtagsInput(value))
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 300 })
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    return Number.isFinite(n) ? n : undefined;
  })
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
