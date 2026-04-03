import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Cleanliness,
  GuestsFrequency,
  NoiseTolerance,
  SleepSchedule,
} from '@prisma/client';

export class UpdatePreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  moveInDate?: string;

  @ApiPropertyOptional({ enum: SleepSchedule })
  @IsOptional()
  @IsEnum(SleepSchedule)
  sleepSchedule?: SleepSchedule;

  @ApiPropertyOptional({ enum: Cleanliness })
  @IsOptional()
  @IsEnum(Cleanliness)
  cleanliness?: Cleanliness;

  @ApiPropertyOptional({ enum: NoiseTolerance })
  @IsOptional()
  @IsEnum(NoiseTolerance)
  noiseTolerance?: NoiseTolerance;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  petFriendly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  smokingAllowed?: boolean;

  @ApiPropertyOptional({ enum: GuestsFrequency })
  @IsOptional()
  @IsEnum(GuestsFrequency)
  guestsFrequency?: GuestsFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  workFromHome?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  aboutMe?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLooking?: boolean;
}
