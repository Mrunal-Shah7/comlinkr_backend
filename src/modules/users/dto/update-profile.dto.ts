import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { IsRealisticDateOfBirth } from '../../../common/validators/date-of-birth.validator'; // SPRINT-57
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Full name of the user',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Unique username',
    minLength: 3,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Username can only contain letters, numbers, and underscores',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  username?: string;

  @ApiPropertyOptional({
    description: 'Short bio, max 200 characters',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  bio?: string;

  @ApiPropertyOptional({
    description: 'Phone number (exactly 10 digits)',
    example: '5551234567',
    minLength: 10,
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, {
    message: 'Phone number must be exactly 10 digits',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phoneNumber?: string;

  @ApiPropertyOptional({
    description:
      'Date of birth (ISO 8601, e.g. 1998-04-23). Age is derived from this and never stored directly.',
    example: '1998-04-23',
  })
  @IsOptional()
  @IsDateString()
  @IsRealisticDateOfBirth() // SPRINT-57: mirrors the 18+ requirement in the Terms of Service
  dateOfBirth?: string;
}
