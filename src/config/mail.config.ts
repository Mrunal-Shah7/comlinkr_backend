import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

function firstConfigString(
  configService: ConfigService,
  keys: string[],
  fallback = '',
): string {
  for (const key of keys) {
    const v = configService.get<string>(key);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return fallback;
}

/** Resolved SMTP + from-address (provider-agnostic SMTP_* env names). */
export function resolveSmtpSettings(configService: ConfigService): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
} {
  const host = firstConfigString(configService, ['SMTP_HOST', 'MAIL_HOST'], 'smtp.resend.com');
  const portRaw = firstConfigString(configService, ['SMTP_PORT', 'MAIL_PORT'], '465');
  const port = parseInt(portRaw, 10) || 465;
  const secure = port === 465;
  const user = firstConfigString(configService, ['SMTP_USER', 'MAIL_USER', 'MAIL_USERNAME']);
  const pass = firstConfigString(configService, ['SMTP_PASSWORD', 'MAIL_PASSWORD']);
  const fromEmail = firstConfigString(configService, [
    'SMTP_FROM_EMAIL',
    'MAIL_FROM',
    'MAIL_FROM_ADDRESS',
    'MAIL_FROM_EMAIL',
  ]);

  return { host, port, secure, user, pass, fromEmail };
}

/** SMTP transporter (Resend or any provider via SMTP_* env). Port 587 = STARTTLS; 465 = implicit TLS. */
export function createMailTransporter(configService: ConfigService): Transporter {
  const { host, port, secure, user, pass } = resolveSmtpSettings(configService);

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
