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

/** Resolved SMTP + from-address (supports SES_* and common MAIL_* / SMTP_* names). */
export function resolveSmtpSettings(configService: ConfigService): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
} {
  const host = firstConfigString(
    configService,
    ['SES_SMTP_HOST', 'MAIL_HOST', 'SMTP_HOST'],
    'email-smtp.us-east-2.amazonaws.com',
  );
  const portRaw = firstConfigString(
    configService,
    ['SES_SMTP_PORT', 'MAIL_PORT', 'SMTP_PORT'],
    '587',
  );
  const port = parseInt(portRaw, 10) || 587;
  const secure = port === 465;
  const user = firstConfigString(configService, [
    'SES_SMTP_USER',
    'MAIL_USER',
    'MAIL_USERNAME',
    'SMTP_USER',
  ]);
  const pass = firstConfigString(configService, [
    'SES_SMTP_PASSWORD',
    'MAIL_PASSWORD',
    'SMTP_PASSWORD',
  ]);
  const fromEmail = firstConfigString(configService, [
    'SES_FROM_EMAIL',
    'MAIL_FROM',
    'MAIL_FROM_ADDRESS',
    'SMTP_FROM',
    'MAIL_FROM_EMAIL',
  ]);

  return { host, port, secure, user, pass, fromEmail };
}

/** AWS SES SMTP (TLS) or any provider via MAIL_* env. Port 587 = STARTTLS; 465 = implicit TLS. */
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
