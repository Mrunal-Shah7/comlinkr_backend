import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsDateString,
  IsOptional,
  IsNumber,
  IsInt,
  Min,
  ValidateIf,
} from 'class-validator';
import { EventCategory, EventFormat, TicketType } from '@prisma/client';

export class CreateEventDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ enum: EventCategory })
  @IsEnum(EventCategory)
  category: EventCategory;

  @ApiProperty({ enum: EventFormat })
  @IsEnum(EventFormat)
  format: EventFormat;

  @ApiProperty({ example: '2026-04-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ maxLength: 20, example: '6:00 PM' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  startTime: string;

  @ApiPropertyOptional({ maxLength: 20, example: '9:00 PM' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  endTime?: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  venue: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiProperty({ enum: TicketType, default: TicketType.FREE })
  @IsEnum(TicketType)
  ticketType: TicketType = TicketType.FREE;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((o) => o.ticketType === 'PAID')
  @IsNumber()
  @Min(0)
  ticketPrice?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
