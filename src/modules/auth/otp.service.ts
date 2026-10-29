import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpType } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { MailService } from './mail.service';
import { getSessionSecret } from '../../config/session.config';

const OTP_MAX_ATTEMPTS = 5;

/** Keyed digest so active codes are not readable from the database. */
function digestOtp(email: string, type: OtpType, code: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(`${email}:${type}:${code}`)
    .digest('hex');
}

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

    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    await this.prisma.otpCode.create({
      data: {
        email,
        code: digestOtp(email, type, code),
        type,
        expiresAt,
        verified: false,
        attempts: 0,
      },
    });

    await this.mailService.sendOtpEmail(email, code, type);
  }

  async verifyOtp(
    email: string,
    code: string,
    type: OtpType,
  ): Promise<boolean> {
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

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpException(
        {
          code: 'OTP_MAX_ATTEMPTS',
          message: 'Too many failed attempts. Request a new code.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const expected = Buffer.from(record.code, 'utf8');
    const actual = Buffer.from(digestOtp(email, type, code), 'utf8');
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      // Atomic increment: concurrent failures cannot overwrite each other.
      await this.prisma.otpCode.updateMany({
        where: { id: record.id, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'Invalid verification code',
      });
    }

    // One-time consumption: only one concurrent verifier can flip verified.
    const consumed = await this.prisma.otpCode.updateMany({
      where: {
        id: record.id,
        verified: false,
        expiresAt: { gt: now },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
      data: { verified: true },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException({
        code: 'OTP_INVALID',
        message: 'Verification code is no longer valid',
      });
    }
    return true;
  }
}
