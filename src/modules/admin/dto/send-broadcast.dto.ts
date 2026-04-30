import { BroadcastAudienceType } from '@prisma/client';
import {
  IsArray,
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
}
