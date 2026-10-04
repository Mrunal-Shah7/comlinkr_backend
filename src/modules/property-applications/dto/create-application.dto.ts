import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty({ description: 'Housing listing being applied for' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  listingId: string;
}
