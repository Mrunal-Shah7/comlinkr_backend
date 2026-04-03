import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerateContentDto {
  @ApiProperty({ enum: ['feed_post', 'housing_listing', 'restaurant'] })
  @IsIn(['feed_post', 'housing_listing', 'restaurant'])
  contentType: string;

  @ApiProperty({ enum: ['approve', 'reject', 'flag'] })
  @IsIn(['approve', 'reject', 'flag'])
  action: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
