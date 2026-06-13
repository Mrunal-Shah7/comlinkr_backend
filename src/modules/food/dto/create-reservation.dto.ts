import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReservationDto {
  @ApiProperty({ example: '2026-04-15' })
  @IsDateString() // SPRINT-29
  date: string;

  @ApiProperty({ example: '19:30', description: 'HH:MM (24-hour)' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'time must be in HH:MM format' }) // SPRINT-29
  time: string;

  @ApiProperty({ minimum: 1, maximum: 20, example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  partySize: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string; // SPRINT-29
}
