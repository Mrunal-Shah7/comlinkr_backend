import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChallengesCronService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 */6 * * *')
  async handleChallengeExpiry() {
    const now = new Date();
    const result = await this.prisma.challenge.updateMany({
      where: {
        status: 'ACTIVE',
        endsAt: { lt: now },
      },
      data: { status: 'ENDED' },
    });
    if (result.count > 0) {
      console.log(
        `[ChallengesCron] Transitioned ${result.count} challenge(s) to ENDED`,
      );
    }
  }
}
