import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class SetVibesDto {
  @ApiPropertyOptional({
    description: 'Selected vibe IDs (0 or more)',
    type: [String],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  vibeIds?: string[];
}
