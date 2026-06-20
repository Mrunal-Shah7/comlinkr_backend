import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { OtpService } from './otp.service';
import { AuthProviderType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import type { Request } from 'express';
import type { Session } from 'express-session';
import type { RegisterInitiateDto } from './dto/register-initiate.dto';
import type { RegisterVerifyDto } from './dto/register-verify.dto';
import type { LoginDto } from './dto/login.dto';
import type { GoogleAuthDto } from './dto/google-auth.dto';
import type { GoogleCompleteDto } from './dto/google-complete.dto';
import type { AppleAuthDto } from './dto/apple-auth.dto';
import type { AppleCompleteDto } from './dto/apple-complete.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import { randomBytes } from 'crypto';

const TEMP_TOKEN_TTL = 600;
const TEMP_TOKEN_PREFIX = 'temp_token:';

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  phoneNumber: string | null;
  role: string;
  onboardingDone: boolean;
  createdAt: Date;
  /** From `UserLocation.city` when set during onboarding / profile. */
  city: string | null;
  userLocation: {
    country: string;
    countryCode: string;
    city: string;
    state: string;
  } | null;
}

export interface ProvidersResponse {
  provider: string;
  linkedAt: Date;
}

/** Session-based auth: client stores `sessionCookie` and sends it as the Cookie header. */
export type AuthSessionPayload = { user: UserResponse };

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly otpService: OtpService,
    private readonly configService: ConfigService,
  ) {
    const primary = this.configService.get<string>('GOOGLE_CLIENT_ID');
    this.googleClient = new OAuth2Client(primary);
  }

  /**
   * ID tokens are minted for the OAuth client that ran the sign-in flow (Web vs Android vs iOS).
   * `verifyIdToken` must allow every client ID you use in Expo / web — same Google Cloud project.
   */
  private getGoogleVerifyAudiences(): string[] {
    const ids = [
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'),
    ];
    const list = this.configService.get<string>('GOOGLE_CLIENT_IDS');
    if (list?.trim()) {
      ids.push(
        ...list
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  private toAuthSession(user: {
    id: string;
    email: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
    bio: string | null;
    phoneNumber: string | null;
    role: string;
    onboardingCompleted: boolean;
    createdAt: Date;
    location?: {
      city: string;
      country: string;
      countryCode: string;
      state: string;
    } | null;
  }): AuthSessionPayload {
    return {
      user: this.formatUserResponse(user),
    };
  }

  private formatUserResponse(user: {
    id: string;
    email: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
    bio: string | null;
    phoneNumber: string | null;
    role: string;
    onboardingCompleted: boolean;
    createdAt: Date;
    location?: {
      city: string;
      country: string;
      countryCode: string;
      state: string;
    } | null;
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.fullName,
      avatarUrl: user.avatarUrl ?? null,
      bio: user.bio,
      phoneNumber: user.phoneNumber,
      role: user.role,
      onboardingDone: user.onboardingCompleted,
      createdAt: user.createdAt,
      city: user.location?.city ?? null,
      userLocation: user.location
        ? {
            country: user.location.country,
            countryCode: user.location.countryCode,
            city: user.location.city,
            state: user.location.state,
          }
        : null,
    };
  }

  /** Full profile for clients (same shape as GET /auth/me). */
  async getUserProfileResponse(userId: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { location: true },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired or not authenticated',
      });
    }
    return this.formatUserResponse(user);
  }

  private regenerateSession(session: Session): Promise<void> {
    return new Promise((resolve, reject) => {
      session.regenerate((err) =>
        err
          ? reject(err instanceof Error ? err : new Error(String(err)))
          : resolve(),
      );
    });
  }

  private saveSession(session: Session): Promise<void> {
    return new Promise((resolve, reject) => {
      session.save((err) =>
        err
          ? reject(err instanceof Error ? err : new Error(String(err)))
          : resolve(),
      );
    });
  }

  private async createTempToken(data: {
    email: string;
    sub: string;
    name: string;
    provider: 'GOOGLE' | 'APPLE';
  }): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const client = this.redis.getClient();
    await client.setEx(
      TEMP_TOKEN_PREFIX + token,
      TEMP_TOKEN_TTL,
      JSON.stringify(data),
    );
    return token;
  }

  private async consumeTempToken(
    token: string,
  ): Promise<{ email: string; sub: string; name: string; provider: string }> {
    const client = this.redis.getClient();
    const key = TEMP_TOKEN_PREFIX + token;
    const value = await client.get(key);
    if (!value) {
      throw new BadRequestException({
        code: 'OTP_EXPIRED',
        message: 'Temporary token has expired. Please try again.',
      });
    }
    await client.del(key);
    return JSON.parse(value) as {
      email: string;
      sub: string;
      name: string;
      provider: string;
    };
  }

  async registerInitiate(
    dto: RegisterInitiateDto,
  ): Promise<{ message: string }> {
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { authProviders: true },
    });
    if (existingByEmail) {
      const hasLocal = existingByEmail.authProviders.some(
        (p) => p.provider === 'LOCAL',
      );
      if (hasLocal) {
        throw new ConflictException({
          code: 'AUTH_EMAIL_EXISTS',
          message: 'An account with this email already exists.',
        });
      }
      const providerName =
        existingByEmail.authProviders[0]?.provider === 'GOOGLE'
          ? 'Google'
          : 'Apple';
      throw new ConflictException({
        code: 'AUTH_PROVIDER_CONFLICT',
        message: `An account with this email exists. Sign in with ${providerName} instead.`,
      });
    }

    const existingByUsername = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existingByUsername) {
      throw new ConflictException({
        code: 'AUTH_USERNAME_EXISTS',
        message: 'This username is already taken.',
      });
    }

    await this.otpService.generateAndSendOtp(dto.email, 'REGISTRATION');
    return { message: 'Verification code sent to your email' };
  }

  async registerVerify(
    dto: RegisterVerifyDto,
    req: Request,
  ): Promise<AuthSessionPayload> {
    await this.otpService.verifyOtp(dto.email, dto.code, 'REGISTRATION');

    const emailTaken = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (emailTaken) {
      throw new ConflictException({
        code: 'AUTH_EMAIL_EXISTS',
        message: 'An account with this email already exists.',
      });
    }
    const usernameTaken = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (usernameTaken) {
      throw new ConflictException({
        code: 'AUTH_USERNAME_EXISTS',
        message: 'This username is already taken.',
      });
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: dto.email,
          username: dto.username,
          fullName: dto.fullName,
          role: 'USER',
          isActive: true,
          onboardingCompleted: false,
        },
      });
      await tx.authProvider.create({
        data: {
          userId: u.id,
          provider: 'LOCAL',
          passwordHash: hashedPassword,
        },
      });
      return u;
    });

    await this.regenerateSession(req.session);
    (req.session as any).userId = user.id;
    (req.session as any).provider = 'LOCAL';
    await this.saveSession(req.session);

    return this.toAuthSession(user);
  }

  async login(dto: LoginDto, req: Request): Promise<AuthSessionPayload> {
    const isEmail = dto.identifier.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail ? { email: dto.identifier } : { username: dto.identifier },
      include: { authProviders: true, location: true },
    });

    const now = new Date();
    const pendingDeletion = user?.deletedAt && user.deletedAt > now;
    if (!user || (!user.isActive && !pendingDeletion)) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email/username or password.',
      });
    }

    const localProvider = user.authProviders.find(
      (p) => p.provider === 'LOCAL',
    );
    if (!localProvider?.passwordHash) {
      throw new UnauthorizedException({
        code: 'AUTH_PROVIDER_CONFLICT',
        message:
          'No password set for this account. Sign in with Google or Apple.',
      });
    }

    const match = await bcrypt.compare(
      dto.password,
      localProvider.passwordHash,
    );
    if (!match) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email/username or password.',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    await this.regenerateSession(req.session);
    (req.session as any).userId = user.id;
    (req.session as any).provider = 'LOCAL';
    await this.saveSession(req.session);

    return this.toAuthSession(user);
  }

  async googleAuth(
    dto: GoogleAuthDto,
    req: Request,
  ): Promise<AuthSessionPayload | { needsUsername: true; tempToken: string }> {
    const audiences = this.getGoogleVerifyAudiences();
    if (audiences.length === 0) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message:
          'Google OAuth is not configured on the server (set GOOGLE_CLIENT_ID to match your app’s Google Cloud OAuth clients).',
      });
    }
    let payload: {
      email?: string;
      email_verified?: boolean | string;
      sub: string;
      name?: string;
    };
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: audiences.length === 1 ? audiences[0] : audiences,
      });
      payload = ticket.getPayload() as any;
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid Google authentication token.',
      });
    }

    if (!payload?.email) {
      throw new UnauthorizedException({
        message: 'Invalid Google token.',
      });
    }
    const emailVerified =
      payload.email_verified === true ||
      payload.email_verified === 'true' ||
      (payload as { email_verified?: number }).email_verified === 1;
    if (!emailVerified) {
      throw new UnauthorizedException({
        message: 'Google email not verified.',
      });
    }

    const email = payload.email;
    const sub = payload.sub;
    const name = payload.name ?? email.split('@')[0];

    const existingProvider = await this.prisma.authProvider.findFirst({
      where: { provider: 'GOOGLE', providerUserId: sub },
      include: { user: { include: { location: true } } },
    });

    if (existingProvider) {
      const user = existingProvider.user;
      const now = new Date();
      const pendingDeletion = user.deletedAt && user.deletedAt > now;
      if (!user.isActive && !pendingDeletion) {
        throw new UnauthorizedException({
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid Google authentication token.',
        });
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });
      await this.regenerateSession(req.session);
      (req.session as any).userId = user.id;
      (req.session as any).provider = 'GOOGLE';
      await this.saveSession(req.session);
      return this.toAuthSession(user);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { location: true },
    });
    if (existingUser) {
      await this.prisma.authProvider.create({
        data: {
          userId: existingUser.id,
          provider: 'GOOGLE',
          providerUserId: sub,
        },
      });
      await this.regenerateSession(req.session);
      (req.session as any).userId = existingUser.id;
      (req.session as any).provider = 'GOOGLE';
      await this.saveSession(req.session);
      return this.toAuthSession(existingUser);
    }

    const tempToken = await this.createTempToken({
      email,
      sub,
      name,
      provider: 'GOOGLE',
    });
    return { needsUsername: true, tempToken };
  }

  async googleComplete(
    dto: GoogleCompleteDto,
    req: Request,
  ): Promise<AuthSessionPayload> {
    const data = await this.consumeTempToken(dto.tempToken);
    if (data.provider !== 'GOOGLE') {
      throw new BadRequestException({
        code: 'OTP_EXPIRED',
        message: 'Invalid temporary token.',
      });
    }

    const usernameTaken = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (usernameTaken) {
      throw new ConflictException({
        code: 'AUTH_USERNAME_EXISTS',
        message: 'This username is already taken.',
      });
    }
    const emailTaken = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (emailTaken) {
      throw new ConflictException({
        code: 'AUTH_EMAIL_EXISTS',
        message: 'An account with this email already exists.',
      });
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: data.email,
          username: dto.username,
          fullName: data.name,
          role: 'USER',
          isActive: true,
          onboardingCompleted: false,
        },
      });
      await tx.authProvider.create({
        data: {
          userId: u.id,
          provider: 'GOOGLE',
          providerUserId: data.sub,
        },
      });
      return u;
    });

    await this.regenerateSession(req.session);
    (req.session as any).userId = user.id;
    (req.session as any).provider = 'GOOGLE';
    await this.saveSession(req.session);
    return this.toAuthSession(user);
  }

  async appleAuth(
    dto: AppleAuthDto,
    req: Request,
  ): Promise<AuthSessionPayload | { needsUsername: true; tempToken: string }> {
    const clientId = this.configService.getOrThrow<string>('APPLE_CLIENT_ID');
    let payload: { email?: string; sub: string };
    try {
      const decoded = await appleSignin.verifyIdToken(dto.idToken, {
        audience: clientId,
      });
      payload = decoded;
    } catch {
      throw new UnauthorizedException({
        message: 'Invalid Apple authentication token.',
      });
    }

    const sub = payload.sub;
    const email = payload.email ?? `${sub}@privaterelay.appleid.com`;
    const name =
      dto.fullName?.trim() || (payload as any).name || email.split('@')[0];

    const existingProvider = await this.prisma.authProvider.findFirst({
      where: {
        provider: 'APPLE',
        providerUserId: sub,
      },
      include: { user: { include: { location: true } } },
    });

    if (existingProvider) {
      const user = existingProvider.user;
      const now = new Date();
      const pendingDeletion = user.deletedAt && user.deletedAt > now;
      if (!user.isActive && !pendingDeletion) {
        throw new UnauthorizedException({
          message: 'Invalid Apple authentication token.',
        });
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });
      await this.regenerateSession(req.session);
      (req.session as any).userId = user.id;
      (req.session as any).provider = 'APPLE';
      await this.saveSession(req.session);
      return this.toAuthSession(user);
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { location: true },
    });
    if (existingUser) {
      await this.prisma.authProvider.create({
        data: {
          userId: existingUser.id,
          provider: 'APPLE',
          providerUserId: sub,
        },
      });
      await this.regenerateSession(req.session);
      (req.session as any).userId = existingUser.id;
      (req.session as any).provider = 'APPLE';
      await this.saveSession(req.session);
      return this.toAuthSession(existingUser);
    }

    const tempToken = await this.createTempToken({
      email,
      sub,
      name,
      provider: 'APPLE',
    });
    return { needsUsername: true, tempToken };
  }

  async appleComplete(
    dto: AppleCompleteDto,
    req: Request,
  ): Promise<AuthSessionPayload> {
    const data = await this.consumeTempToken(dto.tempToken);
    if (data.provider !== 'APPLE') {
      throw new BadRequestException({
        code: 'OTP_EXPIRED',
        message: 'Invalid temporary token.',
      });
    }

    const usernameTaken = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (usernameTaken) {
      throw new ConflictException({
        code: 'AUTH_USERNAME_EXISTS',
        message: 'This username is already taken.',
      });
    }
    const emailTaken = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (emailTaken) {
      throw new ConflictException({
        code: 'AUTH_EMAIL_EXISTS',
        message: 'An account with this email already exists.',
      });
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: data.email,
          username: dto.username,
          fullName: data.name,
          role: 'USER',
          isActive: true,
          onboardingCompleted: false,
        },
      });
      await tx.authProvider.create({
        data: {
          userId: u.id,
          provider: 'APPLE',
          providerUserId: data.sub,
        },
      });
      return u;
    });

    await this.regenerateSession(req.session);
    (req.session as any).userId = user.id;
    (req.session as any).provider = 'APPLE';
    await this.saveSession(req.session);
    return this.toAuthSession(user);
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { authProviders: true },
    });
    const message =
      'If an account exists with this email, a verification code has been sent.';
    if (!user) return { message };
    const hasLocal = user.authProviders.some((p) => p.provider === 'LOCAL');
    if (hasLocal) {
      await this.otpService.generateAndSendOtp(dto.email, 'PASSWORD_RESET');
    }
    return { message };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.otpService.verifyOtp(dto.email, dto.code, 'PASSWORD_RESET');

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { authProviders: true },
    });
    if (!user) {
      throw new BadRequestException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found.',
      });
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    const localProvider = user.authProviders.find(
      (p) => p.provider === 'LOCAL',
    );

    if (localProvider) {
      await this.prisma.authProvider.update({
        where: { id: localProvider.id },
        data: { passwordHash: hashedPassword },
      });
    } else {
      await this.prisma.authProvider.create({
        data: {
          userId: user.id,
          provider: 'LOCAL',
          passwordHash: hashedPassword,
        },
      });
    }
    return { message: 'Password reset successfully' };
  }

  async getMe(userId: string): Promise<UserResponse> {
    return this.getUserProfileResponse(userId);
  }

  async logout(session: Session): Promise<{ message: string }> {
    return new Promise((resolve, reject) => {
      session.destroy((err) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve({ message: 'Logged out successfully' });
      });
    });
  }

  async getProviders(userId: string): Promise<ProvidersResponse[]> {
    const providers = await this.prisma.authProvider.findMany({
      where: { userId },
      select: { provider: true, createdAt: true },
    });
    return providers.map((p) => ({
      provider: p.provider,
      linkedAt: p.createdAt,
    }));
  }

  async unlinkProvider(
    userId: string,
    provider: string,
  ): Promise<{ message: string }> {
    const valid = ['LOCAL', 'GOOGLE', 'APPLE'];
    if (!valid.includes(provider)) {
      throw new BadRequestException({
        message: 'Invalid provider.',
      });
    }

    const count = await this.prisma.authProvider.count({
      where: { userId },
    });
    if (count <= 1) {
      throw new BadRequestException({
        code: 'AUTH_CANNOT_UNLINK',
        message:
          'Cannot remove your only sign-in method. Link another provider first.',
      });
    }

    await this.prisma.authProvider.deleteMany({
      where: { userId, provider: provider as AuthProviderType },
    });
    return { message: 'Provider unlinked successfully' };
  }
}
