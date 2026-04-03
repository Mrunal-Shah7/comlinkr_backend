import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  @Transform(({ value }) => value?.trim().toLowerCase())
  email: string;

  @ApiProperty({ minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ minLength: 6, maxLength: 100 })
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  newPassword: string;
}
