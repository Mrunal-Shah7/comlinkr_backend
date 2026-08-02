import { ApiProperty } from '@nestjs/swagger'; // SPRINT-45: document the mute request body
import { IsBoolean } from 'class-validator'; // SPRINT-45: validate the single required flag

export class UpdateConversationMuteDto {
  // SPRINT-45: carry the desired mute state explicitly (never a toggle)
  @ApiProperty({ type: Boolean, description: 'Desired mute state' }) // SPRINT-45: publish the field contract
  @IsBoolean() // SPRINT-45: reject non-boolean and missing values
  isMuted: boolean; // SPRINT-45: absolute target state so retries stay idempotent
}
