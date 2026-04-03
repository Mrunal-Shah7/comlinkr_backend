import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({ maxLength: 512 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  @IsIn(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';
}
