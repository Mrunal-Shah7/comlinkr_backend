import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NeighborhoodMood } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class VoteNeighborhoodMoodDto {
  @ApiProperty({ enum: NeighborhoodMood })
  @IsEnum(NeighborhoodMood)
  mood: NeighborhoodMood;

  @ApiPropertyOptional({
    description:
      "Optional city override. Defaults to the current user's saved location city.",
  })
  @IsOptional()
  @IsString()
  city?: string;
}
