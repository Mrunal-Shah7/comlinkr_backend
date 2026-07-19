import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt, // SPRINT-36: validate whole-second audio duration
  Max, // SPRINT-36: enforce the voice-note duration ceiling
  Min, // SPRINT-36: reject zero-length voice notes
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MessageType } from '@prisma/client';

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 5000 }) // SPRINT-36: audio messages may intentionally have no text content
  @IsOptional() // SPRINT-36: defer type-dependent content requirements to the service
  @IsString()
  @IsNotEmpty() // SPRINT-36: reject an explicitly supplied empty text value while allowing omission
  @MaxLength(5000)
  content?: string; // SPRINT-36: permit attachment-only audio messages

  @ApiPropertyOptional({ enum: MessageType })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({ description: 'Uploaded audio attachment URL' }) // SPRINT-36: publish the two-step audio send contract
  @IsOptional() // SPRINT-36: require this only through explicit service cross-field validation
  @IsString() // SPRINT-36: accept only a stored URL string
  audioUrl?: string; // SPRINT-36: carry the result of the dedicated audio upload endpoint

  @ApiPropertyOptional({ minimum: 1, maximum: 600 }) // SPRINT-36: document the ten-minute voice-note ceiling
  @IsOptional() // SPRINT-36: require this only for AUDIO through service cross-field validation
  @IsInt() // SPRINT-36: store duration as whole seconds
  @Min(1) // SPRINT-36: reject zero or negative duration
  @Max(600) // SPRINT-36: cap voice notes at ten minutes
  durationSeconds?: number; // SPRINT-36: record client-rounded audio duration
}
