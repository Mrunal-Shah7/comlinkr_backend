import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePrivacyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  publicProfile?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showLocation?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activityStatus?: boolean;
}
