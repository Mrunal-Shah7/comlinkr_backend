import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class PopularDishDto {
  @ApiProperty({ example: 'Omakase Set' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  rank: number;
}
