import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** Coerce RSS RFC-2822 / other parseable dates to ISO so @IsDateString passes. */
function toIsoDateString(value: unknown): unknown {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

// SPRINT-30: body for POST /news/articles/:id/save
export class SaveNewsArticleDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  title: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  url: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @ApiPropertyOptional({ description: 'ISO date string (RFC-2822 from RSS is accepted and normalized)' })
  @IsOptional()
  @Transform(({ value }) => toIsoDateString(value))
  @IsDateString()
  publishedAt?: string;
}
