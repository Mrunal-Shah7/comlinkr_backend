import { ApiPropertyOptional } from '@nestjs/swagger'; // SPRINT-38: Document check-in list filtering.
import { IsEnum, IsOptional } from 'class-validator'; // SPRINT-38: Validate the optional filter.
import { PaginationDto } from '../../../common/dto/pagination.dto'; // SPRINT-38: Reuse standard pagination limits and defaults.

export enum EventCheckInFilter {
  // SPRINT-38: Define scanner dashboard filters.
  CHECKED_IN = 'checked_in', // SPRINT-38: Include registrations already admitted.
  REMAINING = 'remaining', // SPRINT-38: Include active registrations awaiting admission.
} // SPRINT-38: End check-in filters.

export class EventCheckInStatusDto extends PaginationDto {
  // SPRINT-38: Paginate organiser check-in state.
  @ApiPropertyOptional({ enum: EventCheckInFilter }) // SPRINT-38: Publish accepted filter values.
  @IsOptional() // SPRINT-38: Default to all active registrations.
  @IsEnum(EventCheckInFilter) // SPRINT-38: Reject unsupported filter strings.
  filter?: EventCheckInFilter; // SPRINT-38: Optional checked-in/remaining selection.
} // SPRINT-38: End check-in status query DTO.
