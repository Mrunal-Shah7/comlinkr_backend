import { ApiProperty } from '@nestjs/swagger'; // SPRINT-38: Document the scanned ticket request.
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'; // SPRINT-38: Validate input without turning unknown UUIDs into HTTP errors.

export class CheckInTicketDto {
  // SPRINT-38: Carry the stable Sprint 28 attendee identifier.
  @ApiProperty({
    // SPRINT-38: Describe the deployed QR field consumed by the scanner.
    description:
      'The attendeeId decoded from the existing Sprint 28 QR JSON payload', // SPRINT-38: Prevent clients from sending the synthetic ticket display ID.
    example: '7b078b1e-a465-4c2f-85a9-909cb963458b', // SPRINT-38: Show the persisted UUID format.
  }) // SPRINT-38: Complete Swagger ticket metadata.
  @IsString() // SPRINT-38: Let malformed-but-present identifiers return INVALID_TICKET as a result.
  @IsNotEmpty() // SPRINT-38: Require a scanner value.
  @MaxLength(100) // SPRINT-38: Bound lookup input while allowing the deployed UUID.
  ticketId: string; // SPRINT-38: Existing EventAttendee.id from the QR.
} // SPRINT-38: End check-in request DTO.
