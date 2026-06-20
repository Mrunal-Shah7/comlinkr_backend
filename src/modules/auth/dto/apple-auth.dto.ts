import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AppleAuthDto {
  @ApiProperty({ description: 'Apple ID token from client' })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiPropertyOptional({
    description: 'Full name (only on first authorization)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}
