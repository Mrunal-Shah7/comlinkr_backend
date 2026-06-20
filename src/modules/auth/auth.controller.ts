import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AuthService,
  type AuthSessionPayload,
  type UserResponse,
} from './auth.service';
import {
  RegisterInitiateDto,
  RegisterVerifyDto,
  LoginDto,
  GoogleAuthDto,
  GoogleCompleteDto,
  AppleAuthDto,
  AppleCompleteDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto';
import { buildSessionCookieHeader } from '../../config/session-cookie.util';
import { SESSION_COOKIE_NAME } from '../../config/session.config';

function isOAuthPendingUsername(
  r: AuthSessionPayload | { needsUsername: true; tempToken: string },
): r is { needsUsername: true; tempToken: string } {
  return 'needsUsername' in r && r.needsUsername === true;
}

function withSessionCookie<T extends { user: UserResponse }>(
  req: Request,
  payload: T,
): T & { sessionCookie: string } {
  const sid = req.sessionID;
  if (!sid) {
    throw new InternalServerErrorException({
      code: 'AUTH_SESSION_NOT_BOUND',
      message: 'Session was not bound after login. Try again.',
    });
  }
  return { ...payload, sessionCookie: buildSessionCookieHeader(sid) };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('register/initiate')
  @ApiOperation({ summary: 'Start registration, send OTP' })
  @ApiBody({ type: RegisterInitiateDto })
  @ApiResponse({ status: 200, description: 'Verification code sent' })
  @ApiResponse({ status: 409, description: 'Email or username exists' })
  async registerInitiate(@Body() dto: RegisterInitiateDto) {
    return this.authService.registerInitiate(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('register/verify')
  @ApiOperation({ summary: 'Verify OTP and create account' })
  @ApiBody({ type: RegisterVerifyDto })
  @ApiResponse({ status: 201, description: 'Account created, session set' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiResponse({ status: 409, description: 'Email or username exists' })
  async registerVerify(@Body() dto: RegisterVerifyDto, @Req() req: Request) {
    const payload = await this.authService.registerVerify(dto, req);
    return withSessionCookie(req, payload);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  @ApiOperation({ summary: 'Login with email/username and password' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'User and session' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const payload = await this.authService.login(dto, req);
    return withSessionCookie(req, payload);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('google')
  @ApiOperation({ summary: 'Google OAuth login/register' })
  @ApiBody({ type: GoogleAuthDto })
  @ApiResponse({
    status: 200,
    description: 'User or needsUsername + tempToken',
  })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  async googleAuth(@Body() dto: GoogleAuthDto, @Req() req: Request) {
    const result = await this.authService.googleAuth(dto, req);
    if (isOAuthPendingUsername(result)) {
      return result;
    }
    return withSessionCookie(req, result);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('google/complete')
  @ApiOperation({ summary: 'Complete Google registration with username' })
  @ApiBody({ type: GoogleCompleteDto })
  @ApiResponse({ status: 201, description: 'Account created, session set' })
  @ApiResponse({ status: 400, description: 'Invalid/expired temp token' })
  @ApiResponse({ status: 409, description: 'Username or email exists' })
  async googleComplete(@Body() dto: GoogleCompleteDto, @Req() req: Request) {
    const payload = await this.authService.googleComplete(dto, req);
    return withSessionCookie(req, payload);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('apple')
  @ApiOperation({ summary: 'Apple OAuth login/register' })
  @ApiBody({ type: AppleAuthDto })
  @ApiResponse({
    status: 200,
    description: 'User or needsUsername + tempToken',
  })
  @ApiResponse({ status: 401, description: 'Invalid Apple token' })
  async appleAuth(@Body() dto: AppleAuthDto, @Req() req: Request) {
    const result = await this.authService.appleAuth(dto, req);
    if (isOAuthPendingUsername(result)) {
      return result;
    }
    return withSessionCookie(req, result);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('apple/complete')
  @ApiOperation({ summary: 'Complete Apple registration with username' })
  @ApiBody({ type: AppleCompleteDto })
  @ApiResponse({ status: 201, description: 'Account created, session set' })
  @ApiResponse({ status: 400, description: 'Invalid/expired temp token' })
  @ApiResponse({ status: 409, description: 'Username or email exists' })
  async appleComplete(@Body() dto: AppleCompleteDto, @Req() req: Request) {
    const payload = await this.authService.appleComplete(dto, req);
    return withSessionCookie(req, payload);
  }

  @SkipOnboarding()
  @Post('logout')
  @ApiOperation({ summary: 'Destroy session and clear cookie' })
  @ApiResponse({ status: 200, description: 'Logged out' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.logout(req.session);
    res.clearCookie(SESSION_COOKIE_NAME);
    return result;
  }

  @SkipOnboarding()
  @Get('me')
  @ApiOperation({ summary: 'Get current user from session' })
  @ApiResponse({ status: 200, description: 'Current user' })
  @ApiResponse({ status: 401, description: 'Session expired' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @SkipOnboarding()
  @Get('providers')
  @ApiOperation({ summary: 'List linked auth providers' })
  @ApiResponse({ status: 200, description: 'Array of providers' })
  async getProviders(@CurrentUser('id') userId: string) {
    return this.authService.getProviders(userId);
  }

  @Delete('providers/:provider')
  @ApiOperation({ summary: 'Unlink an auth provider' })
  @ApiResponse({ status: 200, description: 'Provider unlinked' })
  @ApiResponse({ status: 400, description: 'Cannot unlink last provider' })
  async unlinkProvider(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
  ) {
    return this.authService.unlinkProvider(userId, provider);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Send password reset OTP' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: 'Generic success message' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password with OTP' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset' })
  @ApiResponse({ status: 400, description: 'Invalid OTP or user not found' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
