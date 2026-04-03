import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateAccountDto {
  @ApiProperty({ description: 'Current password (required for any change)' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => value?.trim().toLowerCase())
  newEmail?: string;

  @ApiPropertyOptional({ minLength: 6, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  newPassword?: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: 20 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_]+$/)
  @Transform(({ value }) => value?.trim().toLowerCase())
  newUsername?: string;
}
