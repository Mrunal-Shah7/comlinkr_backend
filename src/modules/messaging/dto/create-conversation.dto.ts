import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
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
}
