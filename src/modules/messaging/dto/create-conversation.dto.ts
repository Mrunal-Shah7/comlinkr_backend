import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ConversationContextType } from '@prisma/client';

export class CreateConversationDto {
  @ApiProperty({ description: 'Other user ID for DIRECT conversation' })
  @IsUUID()
  @IsNotEmpty()
  participantId: string;

  @ApiPropertyOptional({ enum: ConversationContextType })
  @IsOptional()
  @IsEnum(ConversationContextType)
  contextType?: ConversationContextType;

  @ApiPropertyOptional({ description: 'Listing or event ID that prompted the conversation' })
  @IsOptional()
  @IsUUID()
  contextId?: string;

  /** Accepted for client compatibility; DIRECT threads use contextLabel, not title. */
  @ApiPropertyOptional({ description: 'Ignored for DIRECT; optional display hint from client' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
