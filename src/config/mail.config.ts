import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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

/** Resolved Resend API key and from-address. */
export function resolveMailSettings(configService: ConfigService): {
  apiKey: string;
  fromEmail: string;
} {
  const apiKey = firstConfigString(configService, ['RESEND_API_KEY']);
  const fromEmail = firstConfigString(configService, [
    'RESEND_FROM_EMAIL',
    'SMTP_FROM_EMAIL',
    'MAIL_FROM',
    'MAIL_FROM_ADDRESS',
    'MAIL_FROM_EMAIL',
  ]);

  return { apiKey, fromEmail };
}

/** Resend HTTP API client. */
export function createResendClient(configService: ConfigService): Resend {
  const { apiKey } = resolveMailSettings(configService);
  return new Resend(apiKey);
}
