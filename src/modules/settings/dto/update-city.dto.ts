import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class UpdateCityDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @ApiProperty({ minLength: 2, maxLength: 3 })
  @IsString()
  @IsNotEmpty()
  @Length(2, 3)
  countryCode: string;

  @ApiProperty({ maxLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  dialCode: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;
}
