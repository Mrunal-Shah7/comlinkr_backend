import { ApiProperty } from '@nestjs/swagger'; // SPRINT-38: Document the event review create contract.
import {
  // SPRINT-38: Import validation decorators matching restaurant reviews.
  IsInt, // SPRINT-38: Require an integer rating.
  IsString, // SPRINT-38: Require text review content.
  IsNotEmpty, // SPRINT-38: Reject an empty create-review body.
  Max, // SPRINT-38: Cap ratings at five.
  MaxLength, // SPRINT-38: Match the restaurant create body limit.
  Min, // SPRINT-38: Require at least one star.
} from 'class-validator'; // SPRINT-38: Complete event review validator imports.

export class CreateEventReviewDto {
  // SPRINT-38: Mirror CreateReviewDto for events.
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 }) // SPRINT-38: Publish rating bounds.
  @IsInt() // SPRINT-38: Reject fractional ratings.
  @Min(1) // SPRINT-38: Enforce one-star minimum.
  @Max(5) // SPRINT-38: Enforce five-star maximum.
  rating: number; // SPRINT-38: Store the attendee's rating.

  @ApiProperty({ maxLength: 1000 }) // SPRINT-38: Publish the restaurant-equivalent body limit.
  @IsString() // SPRINT-38: Require string review content.
  @IsNotEmpty() // SPRINT-38: Require content on creation.
  @MaxLength(1000) // SPRINT-38: Match CreateReviewDto exactly.
  content: string; // SPRINT-38: Keep the restaurant field name for client reuse.
} // SPRINT-38: End create event review DTO.
