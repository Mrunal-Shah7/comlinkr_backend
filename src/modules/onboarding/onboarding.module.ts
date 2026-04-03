import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [OnboardingService],
  controllers: [OnboardingController],
  exports: [OnboardingService],
})
export class OnboardingModule {}
