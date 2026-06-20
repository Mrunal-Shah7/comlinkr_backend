import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AttendEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  attendeeName?: string;

  @IsOptional()
  @IsEmail()
  attendeeEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  attendeePhone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  ticketCount?: number;
}
