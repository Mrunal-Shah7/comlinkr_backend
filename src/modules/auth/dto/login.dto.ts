import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Email or username' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => value?.trim())
  identifier: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string;
}
