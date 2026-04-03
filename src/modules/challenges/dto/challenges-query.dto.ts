import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ChallengeType, ChallengeStatus } from '@prisma/client';

export class ChallengesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ChallengeType })
  @IsOptional()
  @IsEnum(ChallengeType)
  type?: ChallengeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ enum: ChallengeStatus, default: 'ACTIVE' })
  @IsOptional()
  @IsEnum(ChallengeStatus)
  status?: ChallengeStatus;
}
