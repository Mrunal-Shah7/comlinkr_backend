import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export function createMailTransporter(configService: ConfigService): Transporter {
  const host = configService.get<string>('MAIL_HOST', 'smtp.gmail.com');
  const port = configService.get<number>('MAIL_PORT', 587);
  const secure = configService.get<string>('MAIL_SECURE', 'false') === 'true';
  const user = configService.get<string>('MAIL_USER');
  const pass = configService.get<string>('MAIL_PASSWORD');
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: user || undefined,
      pass: pass || undefined,
    },
  });
}
