import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateListingDto } from './create-listing.dto';
import { ListingStatus } from '@prisma/client';

export class UpdateListingDto extends PartialType(CreateListingDto) {
  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;
}
