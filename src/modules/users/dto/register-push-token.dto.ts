import { IsNotEmpty, IsString } from 'class-validator';

export class UserRegisterPushTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
