import { ApiPropertyOptional } from '@nestjs/swagger'; // SPRINT-38: Document optional event review updates.
import {
  // SPRINT-38: Import validators matching the restaurant update DTO.
  IsInt, // SPRINT-38: Keep ratings integral.
  IsOptional, // SPRINT-38: Permit either update field independently.
  IsString, // SPRINT-38: Validate content when supplied.
  Max, // SPRINT-38: Cap updated ratings.
  MaxLength, // SPRINT-38: Match restaurant update content length.
  Min, // SPRINT-38: Enforce the rating floor.
} from 'class-validator'; // SPRINT-38: Complete update validator imports.

export class UpdateEventReviewDto {
  // SPRINT-38: Mirror UpdateReviewDto for events.
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) // SPRINT-38: Publish optional rating bounds.
  @IsOptional() // SPRINT-38: Allow content-only updates.
  @IsInt() // SPRINT-38: Reject fractional ratings.
  @Min(1) // SPRINT-38: Enforce one-star minimum.
  @Max(5) // SPRINT-38: Enforce five-star maximum.
  rating?: number; // SPRINT-38: Optional replacement rating.

  @ApiPropertyOptional({ maxLength: 2000 }) // SPRINT-38: Match restaurant update documentation.
  @IsOptional() // SPRINT-38: Allow rating-only updates.
  @IsString() // SPRINT-38: Validate supplied content.
  @MaxLength(2000) // SPRINT-38: Match UpdateReviewDto exactly.
  content?: string; // SPRINT-38: Optional replacement content.
} // SPRINT-38: End update event review DTO.
