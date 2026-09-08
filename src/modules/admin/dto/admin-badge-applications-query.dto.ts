import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadgeApplicationStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

// SPRINT-57: 'ALL' is not a Prisma status — it is the explicit opt-in to the full history.
export const BADGE_APPLICATION_STATUS_FILTERS = [
  ...Object.values(BadgeApplicationStatus),
  'ALL',
] as const;

export type BadgeApplicationStatusFilter =
  (typeof BADGE_APPLICATION_STATUS_FILTERS)[number];

export class AdminBadgeApplicationsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Review status to list. Omitted keeps the pending-review queue behaviour; ALL returns approved and rejected history too.',
    enum: BADGE_APPLICATION_STATUS_FILTERS,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(BADGE_APPLICATION_STATUS_FILTERS as readonly string[])
  status?: BadgeApplicationStatusFilter;

  @ApiPropertyOptional({
    description:
      "Case-insensitive search across the applicant's name, username, email and the legal name on the application.",
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
