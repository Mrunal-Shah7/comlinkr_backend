import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const APPLICATION_DECISIONS = ['approved', 'rejected'] as const;

export class DecideApplicationDto {
  @ApiProperty({ enum: APPLICATION_DECISIONS })
  @IsIn(APPLICATION_DECISIONS, {
    message: `decision must be one of: ${APPLICATION_DECISIONS.join(', ')}`,
  })
  decision: (typeof APPLICATION_DECISIONS)[number];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
