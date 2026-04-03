import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MessageType } from '@prisma/client';

export class SendMessageDto {
  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ enum: MessageType })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;
}
