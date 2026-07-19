import { ApiProperty } from '@nestjs/swagger'; // SPRINT-37: document the complete desired image ordering
import { ArrayUnique, IsArray, IsString } from 'class-validator'; // SPRINT-37: validate a duplicate-free identifier array

export class ReorderListingImagesDto {
  // SPRINT-37: define the idempotent full-order contract
  @ApiProperty({
    type: [String],
    description: 'Every listing image ID exactly once, in desired order',
  }) // SPRINT-37: publish exact set semantics
  @IsArray() // SPRINT-37: reject relative move objects and scalar values
  @ArrayUnique() // SPRINT-37: reject duplicated image identifiers at validation time
  @IsString({ each: true }) // SPRINT-37: require string identifiers throughout the array
  imageIds: string[]; // SPRINT-37: permit an empty array only for a listing that has zero images
} // SPRINT-37: complete reorder DTO
