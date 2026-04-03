import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class BlockUserDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
