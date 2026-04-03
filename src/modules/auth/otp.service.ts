import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpType } from '@prisma/client';
import { MailService } from './mail.service';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async generateAndSendOtp(email: string, type: OtpType): Promise<void> {
    const now = new Date();

    await this.prisma.otpCode.updateMany({
      where: {
        email,
        type,
        verified: false,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    await this.prisma.otpCode.create({
      data: {
        email,
        code,
        type,
        expiresAt,
        verified: false,
        attempts: 0,
      },
    });

    await this.mailService.sendOtpEmail(email, code, type);
  }

  async verifyOtp(email: string, code: string, type: OtpType): Promise<boolean> {
    const now = new Date();

    const record = await this.prisma.otpCode.findFirst({
      where: { email, type, verified: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'No pending verification code found',
      });
    }

    if (record.expiresAt < now) {
      throw new BadRequestException({
        code: 'OTP_EXPIRED',
        message: 'Verification code has expired',
      });
    }

    if (record.attempts >= 5) {
      throw new HttpException(
        {
          code: 'OTP_MAX_ATTEMPTS',
          message: 'Too many failed attempts. Request a new code.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (record.code !== code) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: record.attempts + 1 },
      });
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'Invalid verification code',
      });
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { verified: true },
    });
    return true;
  }
}
