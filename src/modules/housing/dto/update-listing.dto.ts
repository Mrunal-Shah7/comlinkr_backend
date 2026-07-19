import { ApiPropertyOptional } from '@nestjs/swagger';
import { OmitType, PartialType } from '@nestjs/swagger'; // SPRINT-37: inherit current create rules while excluding removed coordinate inputs
import { IsEnum, IsOptional } from 'class-validator';
import { CreateListingDto } from './create-listing.dto';
import { ListingStatus } from '@prisma/client';

export class UpdateListingDto extends PartialType(
  // SPRINT-37: make every permitted creation field optional
  OmitType(CreateListingDto, ['latitude', 'longitude'] as const), // SPRINT-37: keep Sprint 24 removed coordinates out of owner edits
) {
  // SPRINT-37: complete inherited editable field set
  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;
}
