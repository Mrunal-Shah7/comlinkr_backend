import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class NeighborhoodMoodQueryDto {
  @ApiPropertyOptional({
    description:
      "Optional city override. Defaults to the current user's saved location city.",
  })
  @IsOptional()
  @IsString()
  city?: string;
}
