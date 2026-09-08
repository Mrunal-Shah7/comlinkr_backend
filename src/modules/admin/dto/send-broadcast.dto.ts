import { BroadcastAudienceType, BroadcastPriority } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SendBroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  body: string;

  @IsEnum(BroadcastAudienceType)
  audienceType: BroadcastAudienceType;

  @IsOptional()
  @IsString()
  audienceCity?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  audienceUserIds?: string[];

  // SPRINT-57: persisted per broadcast and echoed back by the admin history endpoint
  @IsOptional()
  @IsEnum(BroadcastPriority)
  priority?: BroadcastPriority;

  // SPRINT-57: a future timestamp defers dispatch to AdminCronService; past/absent sends now
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}
