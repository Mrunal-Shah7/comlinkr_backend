import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConversationsQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'listings', 'events'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'listings', 'events'])
  type?: 'all' | 'listings' | 'events' = 'all';

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
