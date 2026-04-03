import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { OtpService } from './otp.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, MailService, OtpService],
  exports: [AuthService],
})
export class AuthModule {}
