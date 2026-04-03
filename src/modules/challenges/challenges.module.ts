import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { ChallengesCronService } from './challenges.cron';

@Module({
  imports: [PrismaModule],
  controllers: [ChallengesController],
  providers: [ChallengesService, ChallengesCronService],
})
export class ChallengesModule {}
