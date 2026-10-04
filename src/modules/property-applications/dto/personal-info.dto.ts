import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const EMPLOYMENT_TYPES = [
  'full_time',
  'self_employed',
  'student',
  'other',
] as const;
export const VIEWING_STATUSES = ['in_person', 'video_tour', 'none'] as const;

/** Step 1 — applicant details. */
export class PersonalInfoDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  currentAddress: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone: string;

  @ApiProperty({ enum: EMPLOYMENT_TYPES })
  @IsIn(EMPLOYMENT_TYPES, {
    message: `employmentType must be one of: ${EMPLOYMENT_TYPES.join(', ')}`,
  })
  employmentType: (typeof EMPLOYMENT_TYPES)[number];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  employerName?: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  monthlyIncome: number;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  incomeBand?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  additionalOccupants?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasPets?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  petDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  smoking?: boolean;

  @ApiProperty({
    description:
      'YYYY-MM-DD, or the display format: MM/DD/YYYY for US listings, DD/MM/YYYY otherwise',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  moveInDate: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  previousLandlordReference?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ enum: VIEWING_STATUSES })
  @IsOptional()
  @IsIn(VIEWING_STATUSES, {
    message: `viewingStatus must be one of: ${VIEWING_STATUSES.join(', ')}`,
  })
  viewingStatus?: (typeof VIEWING_STATUSES)[number];
}
