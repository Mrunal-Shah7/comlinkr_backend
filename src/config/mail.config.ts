import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/** AWS SES SMTP (TLS). Port 587 = STARTTLS; 465 = implicit TLS. */
export function createMailTransporter(configService: ConfigService): Transporter {
  const host = configService.get<string>(
    'SES_SMTP_HOST',
    'email-smtp.us-east-2.amazonaws.com',
  );
  const portRaw = configService.get<string>('SES_SMTP_PORT', '587');
  const port = parseInt(portRaw, 10) || 587;
  const secure = port === 465;
  const user = configService.get<string>('SES_SMTP_USER');
  const pass = configService.get<string>('SES_SMTP_PASSWORD');

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: user || undefined,
      pass: pass || undefined,
    },
  });
}
