import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_ONBOARDING_KEY } from '../decorators/skip-onboarding.decorator';

@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const skipOnboarding = this.reflector.getAllAndOverride<boolean>(
      SKIP_ONBOARDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipOnboarding) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // AuthGuard will have already rejected
    }

    if (user.onboardingCompleted !== true) {
      throw new ForbiddenException({
        code: 'ONBOARDING_REQUIRED',
        message: 'Complete onboarding to access this resource',
      });
    }

    return true;
  }
}
