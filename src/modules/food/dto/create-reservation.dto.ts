import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsString,
  IsNotEmpty,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ example: '2026-04-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '7:30 PM', maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  time: string;

  @ApiProperty({ minimum: 1, maximum: 20, example: 4 })
  @IsInt()
  @Min(1)
  @Max(20)
  partySize: number;
}
