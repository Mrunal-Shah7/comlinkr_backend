import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger, // SPRINT-34: provide structured OAuth verification and revocation diagnostics
  ServiceUnavailableException, // SPRINT-34: fail closed only when Google has no configured audiences
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
const APPLE_ISSUER = 'https://appleid.apple.com'; // SPRINT-34: make the required verified issuer explicit
const DEFAULT_APPLE_BUNDLE_ID = 'com.comlinkr.app'; // SPRINT-34: preserve native production sign-in when env configuration is absent
const APPLE_TOKEN_EXCHANGE_TIMEOUT_MS = 5000; // SPRINT-34: bound optional token exchange latency so sign-in cannot hang

type DecodedTokenClaims = { // SPRINT-34: model only the untrusted claims used for diagnostics
  aud: string; // SPRINT-34: retain a printable received audience
  iss: string; // SPRINT-34: retain a printable received issuer
}; // SPRINT-34: close diagnostic claim shape

type AppleTokenPayload = { // SPRINT-34: describe the verified Apple claims used for authorization
  aud: string; // SPRINT-34: retain the verified audience claim
  email?: string; // SPRINT-34: allow repeat sign-ins that omit email
  iss: string; // SPRINT-34: explicitly validate Apple's issuer
  sub: string; // SPRINT-34: use Apple's stable subject as the primary identity
}; // SPRINT-34: close verified Apple payload shape

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
  termsAcceptedVersion: string | null; // SPRINT-32: server-side terms version audit
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
  private readonly logger = new Logger(AuthService.name); // SPRINT-34: OAuth verification, configuration, and revocation diagnostics
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly otpService: OtpService,
    private readonly configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(); // SPRINT-34: verification receives every valid audience per request
    const appleAudiences = this.getAppleVerifyAudiences(); // SPRINT-34: resolve the production-safe Apple audience list once for startup diagnostics
    let googleAudiences: string[] = []; // SPRINT-34: permit startup when Google is intentionally unconfigured
    try { // SPRINT-34: reuse the request-time Google configuration validator
      googleAudiences = this.getGoogleVerifyAudiences(); // SPRINT-34: count every accepted Google client ID
    } catch (error) { // SPRINT-34: a missing Google configuration is reported by the summary and rejected only on use
      if (!(error instanceof ServiceUnavailableException)) throw error; // SPRINT-34: do not hide unexpected startup failures
    } // SPRINT-34: finish startup-only Google configuration resolution
    if ( // SPRINT-34: replace obsolete request-time Apple identifier failures with one startup warning
      !this.configService.get<string>('APPLE_BUNDLE_ID') && // SPRINT-34: prefer the native bundle identifier
      !this.configService.get<string>('APPLE_CLIENT_ID') // SPRINT-34: recognize the legacy deployment variable
    ) { // SPRINT-34: warn once while continuing with the safe native fallback
      this.logger.warn( // SPRINT-34: surface missing Apple configuration without blocking users
        `[Auth Config] No Apple bundle identifier is configured; using hardcoded default ${DEFAULT_APPLE_BUNDLE_ID}`, // SPRINT-34: state the exact fallback selected
      ); // SPRINT-34: complete one-time startup warning
    } // SPRINT-34: finish fallback warning condition
    const revocationConfigured = this.hasAppleRevocationCredentials(); // SPRINT-34: expose only credential presence, never secret contents
    this.logger.log( // SPRINT-34: emit one PM2-visible startup configuration summary
      `[Auth Config] Apple audiences (${appleAudiences.length}): ${appleAudiences.join(',')}; Google client IDs: ${googleAudiences.length}; Apple revocation credentials present: ${revocationConfigured}`, // SPRINT-34: summarize safe non-secret auth configuration
    ); // SPRINT-34: complete startup summary
  }

  /** SPRINT-34: Resolve native Apple audiences with an explicit development-only extension list. */
  private getAppleVerifyAudiences(): string[] { // SPRINT-34: return every Apple audience accepted by verification
    const configuredPrimary = // SPRINT-34: prefer the native bundle ID and preserve the deployed legacy variable
      this.configService.get<string>('APPLE_BUNDLE_ID')?.trim() || // SPRINT-34: use the explicit native bundle identifier first
      this.configService.get<string>('APPLE_CLIENT_ID')?.trim() || // SPRINT-34: support the prior deployment variable
      DEFAULT_APPLE_BUNDLE_ID; // SPRINT-34: ensure production native sign-in works with no env variables
    const extras = // SPRINT-34: allow opt-in development audiences without weakening production defaults
      this.configService.get<string>('APPLE_EXTRA_AUDIENCES') // SPRINT-34: read comma-separated development audiences
        ?.split(',') // SPRINT-34: separate each configured audience
        .map((audience) => audience.trim()) // SPRINT-34: normalize accidental whitespace
        .filter(Boolean) ?? []; // SPRINT-34: discard empty entries safely
    return [...new Set([configuredPrimary, ...extras])]; // SPRINT-34: preserve order while removing duplicate audiences
  } // SPRINT-34: complete Apple audience resolution

  /** SPRINT-34: Resolve every mobile, web, legacy, and Expo Google audience. */
  private getGoogleVerifyAudiences(): string[] {
    const ids = [ // SPRINT-34: collect each client type that can mint a ComLinkr Google ID token
      this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'), // SPRINT-34: accept native iOS tokens
      this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID'), // SPRINT-34: accept native Android tokens
      this.configService.get<string>('GOOGLE_WEB_CLIENT_ID'), // SPRINT-34: accept Web client and proxy tokens
      this.configService.get<string>('GOOGLE_CLIENT_ID'), // SPRINT-34: preserve the currently deployed legacy variable
      this.configService.get<string>('GOOGLE_EXPO_CLIENT_ID'), // SPRINT-34: accept an explicitly configured development proxy
    ] // SPRINT-34: finish supported Google environment values
      .map((id) => id?.trim()) // SPRINT-34: normalize configured values
      .filter((id): id is string => Boolean(id)); // SPRINT-34: discard missing and empty IDs
    const audiences = [...new Set(ids)]; // SPRINT-34: prevent duplicate verification entries
    if (audiences.length === 0) { // SPRINT-34: Google has no safe hardcoded client-ID fallback
      throw new ServiceUnavailableException( // SPRINT-34: fail closed with an operator-actionable message
        'Google Sign-In is not configured on this server', // SPRINT-34: required request-time configuration error
      ); // SPRINT-34: complete missing-Google exception
    } // SPRINT-34: finish empty-audience guard
    return audiences; // SPRINT-34: verify against every configured Google client ID
  }

  private decodeTokenClaims(token: string): DecodedTokenClaims { // SPRINT-34: decode untrusted JWT claims solely for failure diagnostics
    try { // SPRINT-34: malformed input must still reach authoritative verification
      const payloadSegment = token.split('.')[1]; // SPRINT-34: select the JWT payload segment without trusting it
      if (!payloadSegment) throw new Error('Missing JWT payload'); // SPRINT-34: mark malformed compact tokens as undecodable
      const decoded = JSON.parse( // SPRINT-34: parse the unverified payload for safe claim-only logging
        Buffer.from(payloadSegment, 'base64url').toString('utf8'), // SPRINT-34: decode URL-safe JWT payload bytes
      ) as { aud?: unknown; iss?: unknown }; // SPRINT-34: keep decoded input explicitly untrusted
      const rawAudience = Array.isArray(decoded.aud) // SPRINT-34: support either legal JWT audience representation
        ? decoded.aud.map(String).join(',') // SPRINT-34: render multiple received audiences safely
        : typeof decoded.aud === 'string' // SPRINT-34: accept the common scalar audience claim
          ? decoded.aud // SPRINT-34: retain the scalar audience for logs
          : 'undecodable'; // SPRINT-34: avoid logging arbitrary object values
      const audience = rawAudience.replace(/[\r\n]/g, ' '); // SPRINT-34: keep attacker-controlled diagnostic claims on one log line
      return { // SPRINT-34: expose only the two diagnostic claims
        aud: audience, // SPRINT-34: provide received audience to failure logging
        iss: // SPRINT-34: normalize the untrusted issuer for a single structured log line
          typeof decoded.iss === 'string' // SPRINT-34: accept only a scalar issuer claim
            ? decoded.iss.replace(/[\r\n]/g, ' ') // SPRINT-34: prevent diagnostic log-line injection
            : 'undecodable', // SPRINT-34: use an explicit sentinel for malformed issuer claims
      }; // SPRINT-34: complete decoded diagnostic result
    } catch { // SPRINT-34: never authorize from or fail early on unverified decoding
      return { aud: 'undecodable', iss: 'undecodable' }; // SPRINT-34: use explicit diagnostic sentinels
    } // SPRINT-34: complete safe decode fallback
  } // SPRINT-34: finish unverified claim decoder

  private hasAppleRevocationCredentials(): boolean { // SPRINT-34: centralize revocation-only configuration checks
    return Boolean( // SPRINT-34: report whether every required server-to-server credential exists
      this.configService.get<string>('APPLE_TEAM_ID')?.trim() && // SPRINT-34: require Apple Team ID
      this.configService.get<string>('APPLE_KEY_ID')?.trim() && // SPRINT-34: require Sign in with Apple key ID
      this.configService.get<string>('APPLE_PRIVATE_KEY')?.trim(), // SPRINT-34: require the ES256 private key only for server-to-server calls
    ); // SPRINT-34: complete revocation credential presence check
  } // SPRINT-34: finish revocation configuration helper

  private getAppleServerCredentials(): { // SPRINT-34: resolve normalized credentials for code exchange and revocation
    teamId: string; // SPRINT-34: Apple developer team identifier
    keyId: string; // SPRINT-34: Sign in with Apple key identifier
    privateKey: string; // SPRINT-34: normalized PEM private key
  } | null { // SPRINT-34: return null when revocation is not configured
    const teamId = this.configService.get<string>('APPLE_TEAM_ID')?.trim(); // SPRINT-34: resolve Apple Team ID
    const keyId = this.configService.get<string>('APPLE_KEY_ID')?.trim(); // SPRINT-34: resolve Apple key ID
    const configuredKey = this.configService.get<string>('APPLE_PRIVATE_KEY'); // SPRINT-34: read the private key only in server-to-server paths
    if (!teamId || !keyId || !configuredKey?.trim()) return null; // SPRINT-34: skip optional compliance calls when configuration is incomplete
    return { // SPRINT-34: provide complete normalized credentials
      teamId, // SPRINT-34: retain Apple Team ID
      keyId, // SPRINT-34: retain Apple key ID
      privateKey: configuredKey.replace(/\\n/g, '\n'), // SPRINT-34: restore PEM newlines from one-line environment values
    }; // SPRINT-34: complete credential object
  } // SPRINT-34: finish Apple server credential resolver

  private createAppleClientSecret(): string | null { // SPRINT-34: generate the short-lived ES256 secret used only with Apple server endpoints
    const credentials = this.getAppleServerCredentials(); // SPRINT-34: require complete revocation credentials
    if (!credentials) return null; // SPRINT-34: let callers skip without breaking sign-in or deletion
    const clientId = this.getAppleVerifyAudiences()[0]; // SPRINT-34: use the native bundle identifier that received the authorization code
    return appleSignin.getClientSecret({ // SPRINT-34: delegate standards-compliant client-secret signing to the installed package
      clientID: clientId, // SPRINT-34: set JWT subject to the native app bundle identifier
      teamID: credentials.teamId, // SPRINT-34: set JWT issuer to the Apple Team ID
      keyIdentifier: credentials.keyId, // SPRINT-34: set the ES256 key identifier header
      privateKey: credentials.privateKey, // SPRINT-34: sign with the normalized p8 key
      expAfter: 300, // SPRINT-34: keep the client secret short-lived
    }); // SPRINT-34: complete Apple client-secret generation
  } // SPRINT-34: finish Apple client-secret helper

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
    termsAcceptedVersion?: string | null; // SPRINT-32: terms version on user record
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
    termsAcceptedVersion?: string | null; // SPRINT-32: terms version on user record
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
      termsAcceptedVersion: user.termsAcceptedVersion ?? null, // SPRINT-32: expose terms version in auth responses
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
    refreshToken?: string; // SPRINT-34: carry an exchanged Apple refresh token through username completion
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
  ): Promise<{ // SPRINT-34: include optional revocation material in one-time OAuth registration data
    email: string; // SPRINT-34: preserve verified provider email
    sub: string; // SPRINT-34: preserve stable provider subject
    name: string; // SPRINT-34: preserve null-safe display name
    provider: string; // SPRINT-34: preserve provider binding
    refreshToken?: string; // SPRINT-34: persist an Apple refresh token after username selection
  }> { // SPRINT-34: close temporary-token return shape
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
      refreshToken?: string; // SPRINT-34: restore an exchanged Apple refresh token if present
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
    const audiences = this.getGoogleVerifyAudiences(); // SPRINT-34: require and resolve every configured Google audience
    const untrustedClaims = this.decodeTokenClaims(dto.idToken); // SPRINT-34: decode only audience and issuer for diagnostics
    let payload: { // SPRINT-34: model the verified Google claims used below
      aud: string; // SPRINT-34: retain the verified client audience
      email?: string; // SPRINT-34: require email after cryptographic verification
      email_verified?: boolean | string | number; // SPRINT-34: handle provider claim representations defensively
      iss: string; // SPRINT-34: explicitly validate either documented Google issuer
      sub: string; // SPRINT-34: use Google's stable subject for primary lookup
      name?: string; // SPRINT-34: permit a missing provider display name
    }; // SPRINT-34: close verified Google payload shape
    try { // SPRINT-34: log every cryptographic or issuer verification failure with audience context
      const ticket = await this.googleClient.verifyIdToken({ // SPRINT-34: verify signature, expiry, and all accepted audiences
        idToken: dto.idToken, // SPRINT-34: pass the client-supplied compact ID token without logging it
        audience: audiences, // SPRINT-34: accept iOS, Android, Web, legacy, or explicit Expo client IDs
      }); // SPRINT-34: complete Google verification options
      const verifiedPayload = ticket.getPayload(); // SPRINT-34: use claims only after library verification succeeds
      if (!verifiedPayload) throw new Error('Google token payload is missing'); // SPRINT-34: reject an unusable verified ticket
      if ( // SPRINT-34: visibly enforce both valid Google issuer forms
        verifiedPayload.iss !== 'accounts.google.com' && // SPRINT-34: accept Google's bare issuer
        verifiedPayload.iss !== 'https://accounts.google.com' // SPRINT-34: accept Google's HTTPS issuer
      ) { // SPRINT-34: reject every other issuer
        throw new Error(`Invalid Google issuer: ${verifiedPayload.iss}`); // SPRINT-34: route issuer failures through structured diagnostics
      } // SPRINT-34: complete explicit Google issuer assertion
      payload = verifiedPayload as typeof payload; // SPRINT-34: retain the library-verified claims
    } catch (err) { // SPRINT-34: normalize and report the underlying verification error
      const error = err instanceof Error ? err : new Error(String(err)); // SPRINT-34: guarantee name and message fields for logging
      this.logger.warn( // SPRINT-34: produce one complete PM2-visible Google verification failure line
        `[Google Auth] verifyIdToken failed — received audience: ${untrustedClaims.aud} — expected audiences: ${audiences.join(',')} — name: ${error.name} — error: ${error.message}`, // SPRINT-34: include received and expected audiences without token or email data
      ); // SPRINT-34: complete Google verification diagnostic
      throw new UnauthorizedException({ // SPRINT-34: preserve a safe client-facing authentication failure
        code: 'AUTH_INVALID_CREDENTIALS', // SPRINT-34: preserve the established auth error code
        message: 'Invalid Google authentication token', // SPRINT-34: return the required generic failure text
      }); // SPRINT-34: complete Google verification rejection
    } // SPRINT-34: finish verified Google token handling

    if (!payload.email) { // SPRINT-34: require an identity email after verification
      throw new UnauthorizedException({ // SPRINT-34: reject payloads that cannot resolve an account
        message: 'Invalid Google authentication token', // SPRINT-34: avoid exposing token details
      }); // SPRINT-34: complete missing-email rejection
    } // SPRINT-34: finish required Google email check
    const emailVerified = // SPRINT-34: normalize the verified-email claim without weakening it
      payload.email_verified === true || // SPRINT-34: accept Google's standard boolean representation
      payload.email_verified === 'true' || // SPRINT-34: accept documented string representation
      payload.email_verified === 1; // SPRINT-34: preserve compatibility with numeric provider payloads
    if (!emailVerified) { // SPRINT-34: prevent unsafe email-based auto-linking
      throw new BadRequestException( // SPRINT-34: return the required clear client action
        'Your Google account email is not verified. Please verify it with Google and try again.', // SPRINT-34: explain how to resolve unverified email
      ); // SPRINT-34: complete unverified-email rejection
    } // SPRINT-34: finish verified-email requirement

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

  private async exchangeAppleAuthorizationCode( // SPRINT-34: exchange Apple's one-time code without ever breaking sign-in
    authorizationCode?: string, // SPRINT-34: accept the optional backward-compatible mobile field
  ): Promise<string | null> { // SPRINT-34: return only a usable refresh token
    const code = authorizationCode?.trim(); // SPRINT-34: treat absent and whitespace-only codes as missing
    if (!code) return null; // SPRINT-34: preserve existing clients that send no authorization code
    if (!this.hasAppleRevocationCredentials()) { // SPRINT-34: keep private-key checks out of identity-token verification
      this.logger.warn( // SPRINT-34: explain why compliant refresh-token storage was skipped
        '[Apple Auth] authorization code exchange skipped due to missing revocation configuration', // SPRINT-34: identify the optional configuration failure
      ); // SPRINT-34: complete missing-configuration warning
      return null; // SPRINT-34: never block sign-in for absent server-to-server credentials
    } // SPRINT-34: finish exchange configuration guard
    try { // SPRINT-34: isolate every Apple token-endpoint failure
      const clientSecret = this.createAppleClientSecret(); // SPRINT-34: sign a short-lived native-app client secret
      if (!clientSecret) return null; // SPRINT-34: remain fail-safe if configuration changes during the request
      const clientId = this.getAppleVerifyAudiences()[0]; // SPRINT-34: exchange the code under the native bundle identifier
      const response = (await Promise.race([ // SPRINT-34: await storage-critical exchange only within a safe latency bound
        appleSignin.getAuthorizationToken(code, { // SPRINT-34: request tokens with the authorization-code grant
          clientID: clientId, // SPRINT-34: identify the native app that received the code
          clientSecret, // SPRINT-34: authenticate the server to Apple's token endpoint
          redirectUri: '', // SPRINT-34: native Apple authorization codes have no web redirect URI
        }), // SPRINT-34: complete Apple package exchange request
        new Promise<never>((_, reject) => // SPRINT-34: prevent a slow Apple endpoint from timing out user sign-in
          setTimeout( // SPRINT-34: reject the optional operation after the bounded wait
            () => reject(new Error('Apple token exchange timed out')), // SPRINT-34: route timeout through the standard warning path
            APPLE_TOKEN_EXCHANGE_TIMEOUT_MS, // SPRINT-34: apply the explicit exchange latency ceiling
          ), // SPRINT-34: complete exchange timeout scheduling
        ), // SPRINT-34: complete timeout promise
      ])) as { refresh_token?: string; error?: string; error_description?: string }; // SPRINT-34: handle both package success and Apple error payloads
      if (response.error) { // SPRINT-34: the package returns Apple endpoint errors instead of throwing
        throw new Error( // SPRINT-34: route endpoint errors through the required warning log
          `${response.error}: ${response.error_description ?? 'Apple token exchange rejected'}`, // SPRINT-34: retain Apple's non-secret failure reason
        ); // SPRINT-34: complete endpoint error conversion
      } // SPRINT-34: finish Apple error-payload handling
      return response.refresh_token?.trim() || null; // SPRINT-34: store only a non-empty refresh token
    } catch (err) { // SPRINT-34: prevent exchange failures from affecting authentication
      const error = err instanceof Error ? err : new Error(String(err)); // SPRINT-34: normalize unknown package errors
      this.logger.warn( // SPRINT-34: emit the required exchange diagnostic prefix
        `[Apple Auth] authorization code exchange failed — ${error.name}: ${error.message}`, // SPRINT-34: log no code, token, key, or email
      ); // SPRINT-34: complete exchange failure warning
      return null; // SPRINT-34: preserve successful user sign-in
    } // SPRINT-34: finish isolated code exchange
  } // SPRINT-34: complete authorization-code exchange helper

  public async revokeAppleAuthorization(userId: string): Promise<void> { // SPRINT-34: attempt Apple revocation before account data is purged
    try { // SPRINT-34: guarantee revocation never prevents deletion
      const provider = await this.prisma.authProvider.findUnique({ // SPRINT-34: load the one Apple provider row allowed per user
        where: { userId_provider: { userId, provider: 'APPLE' } }, // SPRINT-34: address the compound provider constraint
        select: { refreshToken: true }, // SPRINT-34: retrieve only revocation material
      }); // SPRINT-34: complete Apple provider lookup
      if (!provider) return; // SPRINT-34: skip users who never used Apple Sign-In
      if (!provider.refreshToken) { // SPRINT-34: support accounts created before authorization-code collection
        this.logger.log( // SPRINT-34: record the expected pre-contract-change skip path
          '[Apple Auth] revocation skipped because no refresh token is stored', // SPRINT-34: avoid logging user or token data
        ); // SPRINT-34: complete missing-token informational log
        return; // SPRINT-34: continue account deletion normally
      } // SPRINT-34: finish missing-refresh-token handling
      if (!this.hasAppleRevocationCredentials()) { // SPRINT-34: require private credentials only in the revocation path
        this.logger.warn( // SPRINT-34: surface incomplete compliance configuration
          '[Apple Auth] revocation skipped due to missing revocation configuration', // SPRINT-34: explain the safe deletion continuation
        ); // SPRINT-34: complete missing-configuration warning
        return; // SPRINT-34: user deletion takes precedence over revocation success
      } // SPRINT-34: finish revocation configuration guard
      const clientSecret = this.createAppleClientSecret(); // SPRINT-34: sign a short-lived server credential
      if (!clientSecret) return; // SPRINT-34: tolerate configuration changing during deletion
      const response = (await appleSignin.revokeAuthorizationToken(provider.refreshToken, { // SPRINT-34: call Apple's revocation endpoint before database deletion
        clientID: this.getAppleVerifyAudiences()[0], // SPRINT-34: use the native app bundle identifier
        clientSecret, // SPRINT-34: authenticate the revocation request
        tokenTypeHint: 'refresh_token', // SPRINT-34: tell Apple the persisted token type
      })) as { error?: string; error_description?: string } | undefined; // SPRINT-34: inspect package-returned Apple endpoint errors
      if (response?.error) { // SPRINT-34: treat a non-throwing Apple error payload as revocation failure
        throw new Error( // SPRINT-34: route the endpoint error through deletion-safe logging
          `${response.error}: ${response.error_description ?? 'Apple revocation rejected'}`, // SPRINT-34: retain Apple's non-secret failure reason
        ); // SPRINT-34: complete revocation error conversion
      } // SPRINT-34: finish Apple revocation response validation
    } catch (err) { // SPRINT-34: deletion must proceed after every revocation failure
      const error = err instanceof Error ? err : new Error(String(err)); // SPRINT-34: normalize unknown package errors
      this.logger.warn( // SPRINT-34: emit the required non-blocking revocation diagnostic
        `[Apple Auth] revocation failed — ${error.name}: ${error.message}`, // SPRINT-34: log no refresh token, secret, or email
      ); // SPRINT-34: complete revocation failure warning
    } // SPRINT-34: finish deletion-safe revocation attempt
  } // SPRINT-34: complete public account-revocation method

  async appleAuth( // SPRINT-34: verify native Apple tokens and handle repeat sign-ins safely
    dto: AppleAuthDto, // SPRINT-34: accept identity token, optional name, and optional authorization code
    req: Request, // SPRINT-34: establish the existing session contract
  ): Promise<AuthSessionPayload | { needsUsername: true; tempToken: string }> {
    const audiences = this.getAppleVerifyAudiences(); // SPRINT-34: include native production and explicit development audiences
    const untrustedClaims = this.decodeTokenClaims(dto.idToken); // SPRINT-34: decode aud and iss only for diagnostics
    let payload: AppleTokenPayload; // SPRINT-34: retain only cryptographically verified Apple claims
    try { // SPRINT-34: capture library and explicit issuer failures in one structured log path
      const verified = await appleSignin.verifyIdToken(dto.idToken, { // SPRINT-34: verify against Apple's rotating public JWKS
        audience: audiences, // SPRINT-34: accept any configured native or explicit development audience
      }); // SPRINT-34: complete Apple verification options
      payload = verified as AppleTokenPayload; // SPRINT-34: use claims only after signature and audience verification
      if (payload.iss !== APPLE_ISSUER) { // SPRINT-34: explicitly enforce Apple's documented issuer
        throw new Error(`Invalid Apple issuer: ${payload.iss}`); // SPRINT-34: route issuer mismatch through complete diagnostics
      } // SPRINT-34: complete explicit Apple issuer assertion
    } catch (err) { // SPRINT-34: normalize and report the underlying verification error
      const error = err instanceof Error ? err : new Error(String(err)); // SPRINT-34: guarantee safe error fields
      this.logger.warn( // SPRINT-34: emit one complete PM2-visible verification failure line
        `[Apple Auth] verifyIdToken failed — received audience: ${untrustedClaims.aud} — expected audiences: ${audiences.join(',')} — issuer: ${untrustedClaims.iss} — name: ${error.name} — error: ${error.message}`, // SPRINT-34: include only non-secret diagnostic claims and error data
      ); // SPRINT-34: complete Apple verification diagnostic
      throw new UnauthorizedException({ // SPRINT-34: preserve a generic client-facing authentication failure
        message: 'Invalid Apple authentication token', // SPRINT-34: required safe error message
      }); // SPRINT-34: complete Apple verification rejection
    } // SPRINT-34: finish verified Apple token handling

    const sub = payload.sub; // SPRINT-34: use Apple's stable opaque subject as the identity key
    const existingProvider = await this.prisma.authProvider.findFirst({ // SPRINT-34: perform stable-subject lookup before any email lookup
      where: { // SPRINT-34: constrain lookup to the Apple provider namespace
        provider: 'APPLE', // SPRINT-34: avoid cross-provider subject collisions
        providerUserId: sub, // SPRINT-34: resolve repeat sign-ins even when email and name are absent
      }, // SPRINT-34: complete Apple provider lookup criteria
      include: { user: { include: { location: true } } }, // SPRINT-34: load the established user response data
    }); // SPRINT-34: complete primary returning-user query

    if (existingProvider) { // SPRINT-34: return the already-linked account without duplicate rows
      const user = existingProvider.user; // SPRINT-34: retain the stored email and real display name unchanged
      const now = new Date(); // SPRINT-34: preserve pending-deletion authentication behavior
      const pendingDeletion = user.deletedAt && user.deletedAt > now; // SPRINT-34: distinguish grace-period users from disabled accounts
      if (!user.isActive && !pendingDeletion) { // SPRINT-34: reject permanently inactive accounts
        throw new UnauthorizedException({ // SPRINT-34: avoid disclosing account state
          message: 'Invalid Apple authentication token', // SPRINT-34: preserve generic Apple failure text
        }); // SPRINT-34: complete inactive-account rejection
      } // SPRINT-34: finish account activity validation
      const refreshToken = await this.exchangeAppleAuthorizationCode( // SPRINT-34: opportunistically obtain revocation material
        dto.authorizationCode, // SPRINT-34: exchange only when the mobile client supplies the native code
      ); // SPRINT-34: complete optional returning-user exchange
      if (refreshToken) { // SPRINT-34: never clear a previously stored valid refresh token
        await this.prisma.authProvider.update({ // SPRINT-34: persist newly returned revocation material
          where: { id: existingProvider.id }, // SPRINT-34: update the already-resolved provider row
          data: { refreshToken }, // SPRINT-34: store Apple's opaque refresh token
        }); // SPRINT-34: complete refresh-token persistence
      } // SPRINT-34: finish optional provider update
      await this.prisma.user.update({ // SPRINT-34: preserve existing last-active tracking without mutating name or email
        where: { id: user.id }, // SPRINT-34: update the stable-subject user only
        data: { lastActiveAt: new Date() }, // SPRINT-34: refresh activity metadata for returning Apple users
      }); // SPRINT-34: complete returning-user activity update
      await this.regenerateSession(req.session); // SPRINT-34: prevent session fixation on repeat Apple sign-in
      (req.session as any).userId = user.id; // SPRINT-34: bind the session to the stable-subject user
      (req.session as any).provider = 'APPLE'; // SPRINT-34: record the authentication provider
      await this.saveSession(req.session); // SPRINT-34: persist the session before responding
      return this.toAuthSession(user); // SPRINT-34: return stored user data without name or email mutation
    } // SPRINT-34: finish returning-user path

    const email = payload.email?.trim(); // SPRINT-34: accept real and private-relay emails exactly as Apple provides them
    if (!email) { // SPRINT-34: only a previously linked subject may sign in without an email claim
      throw new BadRequestException( // SPRINT-34: return a clear recoverable first-sign-in error
        'Apple did not provide an email address for this account. Please sign in again and choose to share your email.', // SPRINT-34: required user guidance for missing email
      ); // SPRINT-34: complete missing-email response
    } // SPRINT-34: finish first-sign-in email requirement

    const existingUser = await this.prisma.user.findUnique({ // SPRINT-34: perform email auto-link only after stable-subject lookup fails
      where: { email }, // SPRINT-34: use Apple's verified real or private-relay address as received
      include: { location: true }, // SPRINT-34: load established response data for auto-linking
    }); // SPRINT-34: complete secondary email lookup
    if (existingUser) { // SPRINT-34: preserve the existing OAuth auto-link behavior
      const provider = await this.prisma.authProvider.create({ // SPRINT-34: link Apple's stable subject to the existing account
        data: { // SPRINT-34: create exactly one Apple provider row
          userId: existingUser.id, // SPRINT-34: link to the email-resolved user
          provider: 'APPLE', // SPRINT-34: identify the provider namespace
          providerUserId: sub, // SPRINT-34: persist Apple's stable subject for future primary lookup
        }, // SPRINT-34: complete auto-link provider data
      }); // SPRINT-34: finish Apple provider auto-link
      const refreshToken = await this.exchangeAppleAuthorizationCode( // SPRINT-34: obtain optional revocation material after the provider exists
        dto.authorizationCode, // SPRINT-34: use the native one-time authorization code
      ); // SPRINT-34: complete optional auto-link exchange
      if (refreshToken) { // SPRINT-34: update only when Apple returned a usable token
        await this.prisma.authProvider.update({ // SPRINT-34: attach refresh token to the new provider row
          where: { id: provider.id }, // SPRINT-34: update the exact auto-linked provider
          data: { refreshToken }, // SPRINT-34: persist revocation material
        }); // SPRINT-34: complete auto-linked refresh-token persistence
      } // SPRINT-34: finish optional token storage
      await this.regenerateSession(req.session); // SPRINT-34: prevent session fixation after auto-link
      (req.session as any).userId = existingUser.id; // SPRINT-34: establish the resolved account session
      (req.session as any).provider = 'APPLE'; // SPRINT-34: record Apple as the session provider
      await this.saveSession(req.session); // SPRINT-34: persist session before response
      return this.toAuthSession(existingUser); // SPRINT-34: keep the existing stored name and email unchanged
    } // SPRINT-34: finish existing-email auto-link path

    const flatName = dto.fullName?.trim(); // SPRINT-34: prefer a non-empty first-authorization full name
    const structuredName = [dto.name?.givenName, dto.name?.familyName] // SPRINT-34: support null-safe structured Apple name parts
      .filter((part): part is string => Boolean(part?.trim())) // SPRINT-34: discard absent and empty name components
      .map((part) => part.trim()) // SPRINT-34: normalize each supplied name component
      .join(' ') // SPRINT-34: combine present parts with one space
      .trim(); // SPRINT-34: ensure the structured result is non-empty or blank
    const name = // SPRINT-34: apply the required first-available fallback chain for a new account
      flatName || // SPRINT-34: use the flat request name first
      structuredName || // SPRINT-34: otherwise use structured given and family names
      email.split('@')[0]?.trim() || // SPRINT-34: derive a safe display name from the verified email prefix
      'ComLinkr User'; // SPRINT-34: provide a final null-safe literal fallback
    const refreshToken = await this.exchangeAppleAuthorizationCode( // SPRINT-34: preserve revocation material through username completion
      dto.authorizationCode, // SPRINT-34: exchange the optional native code before it expires
    ); // SPRINT-34: complete new-user code exchange
    const tempToken = await this.createTempToken({ // SPRINT-34: preserve the existing needs-username flow
      email, // SPRINT-34: store Apple's verified real or relay address unchanged
      sub, // SPRINT-34: store the stable subject used for provider creation
      name, // SPRINT-34: store the null-safe resolved display name
      provider: 'APPLE', // SPRINT-34: bind completion to the Apple provider
      ...(refreshToken ? { refreshToken } : {}), // SPRINT-34: carry revocation material only when exchange succeeded
    }); // SPRINT-34: complete temporary registration token creation
    return { needsUsername: true, tempToken }; // SPRINT-34: preserve the existing username-selection response contract
  } // SPRINT-34: complete corrected Apple authentication flow

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
          refreshToken: data.refreshToken, // SPRINT-34: persist revocation material carried through username completion
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
