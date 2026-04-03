import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class SetLocationDto {
  @ApiProperty({ description: 'Country name', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  country: string;

  @ApiProperty({ description: 'ISO country code', minLength: 2, maxLength: 3 })
  @IsString()
  @IsNotEmpty()
  @Length(2, 3)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  countryCode: string;

  @ApiProperty({ description: 'Dial code e.g. +91', maxLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  dialCode: string;

  @ApiProperty({ description: 'State or province', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  state: string;

  @ApiProperty({ description: 'City', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  city: string;
}
