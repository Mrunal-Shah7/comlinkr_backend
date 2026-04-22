import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class NewsExploreQueryDto {
  @ApiPropertyOptional({ example: 'Los Angeles' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'United States' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @ApiPropertyOptional({ enum: ['primary', 'full'], default: 'full' })
  @IsOptional()
  @IsString()
  @IsIn(['primary', 'full'])
  phase?: 'primary' | 'full';
}
