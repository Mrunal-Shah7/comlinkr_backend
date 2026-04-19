import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMailTransporter, resolveSmtpSettings } from '../../config/mail.config';

@Injectable()
export class MailService {
  constructor(private readonly configService: ConfigService) {}

  async sendOtpEmail(
    to: string,
    code: string,
    type: 'REGISTRATION' | 'PASSWORD_RESET',
  ): Promise<void> {
    const { user: smtpUser, pass: smtpPass, fromEmail } = resolveSmtpSettings(
      this.configService,
    );
    const isDev = this.configService.get<string>('NODE_ENV') === 'development';
    const credentialsMissing =
      !smtpUser ||
      !smtpPass ||
      !fromEmail ||
      smtpPass === 'placeholder';

    if (credentialsMissing) {
      if (isDev) {
        console.log(`[DEV] No SMTP credentials — OTP logged only: ${to} (${type}): ${code}`);
      }
      return;
    }

    const transporter = createMailTransporter(this.configService);

    const subject =
      type === 'REGISTRATION'
        ? 'Your ComLinkr verification code'
        : 'Reset your ComLinkr password';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 480px; margin: 0 auto; padding: 24px;">
  <div style="margin-bottom: 24px;">
    <strong style="font-size: 1.25rem;">ComLinkr</strong>
  </div>
  <p style="margin-bottom: 16px;">Your verification code is:</p>
  <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin: 24px 0; padding: 16px; background: #f4f4f4; border-radius: 8px; text-align: center;">${code}</p>
  <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
  <p style="color: #666; font-size: 14px; margin-top: 32px;">If you didn't request this, please ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="color: #999; font-size: 12px;">ComLinkr — Community-First Housing & Lifestyle</p>
</body>
</html>`;

    try {
      await transporter.sendMail({
        from: `"ComLinkr" <${fromEmail}>`,
        to,
        subject,
        html,
      });
      if (isDev) {
        console.log(`[DEV] OTP email sent to ${to} (${type}); code: ${code}`);
      }
    } catch (err) {
      console.error('Failed to send OTP email:', err);
      if (isDev) {
        console.log(`[DEV] OTP (use this if email failed): ${to} (${type}): ${code}`);
      }
      // Do not throw — OTP is saved; user can request a new one.
    }
  }
}
