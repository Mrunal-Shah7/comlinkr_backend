import { ApiProperty } from '@nestjs/swagger';
import { BadgeType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class GrantUserBadgeDto {
  @ApiProperty({ enum: BadgeType })
  @IsEnum(BadgeType)
  badgeType: BadgeType;
}
