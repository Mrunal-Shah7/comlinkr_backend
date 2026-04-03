import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CommunityStatsQueryDto {
  @ApiPropertyOptional({
    description:
      'City to scope stats (members with this location, Q&A in this city). Defaults to the current user profile city.',
  })
  @IsOptional()
  @IsString()
  city?: string;
}
