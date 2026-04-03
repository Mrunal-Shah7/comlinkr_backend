import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class SetCommunitiesDto {
  @ApiPropertyOptional({
    description: 'Community IDs to join (can be empty to skip)',
    type: [String],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  communityIds?: string[];
}
