import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from './settings.service'; // SPRINT-32: delegate hard-delete to shared service method

@Injectable()
export class SettingsCronService {
  private readonly logger = new Logger(SettingsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService, // SPRINT-32: shared performHardDelete
  ) {}

  @Cron('0 3 * * *')
  async handleAccountHardDelete() {
    const now = new Date();
    const usersToDelete = await this.prisma.user.findMany({
      where: {
        isActive: false,
        deletedAt: { lte: now, not: null },
      },
      select: { id: true },
    });
    let deleted = 0;
    for (const user of usersToDelete) {
      try {
        await this.settingsService.performHardDelete(user.id); // SPRINT-32: shared cascade transaction
        deleted++;
      } catch (err) {
        this.logger.warn(`Failed to hard-delete user ${user.id}: ${err}`);
      }
    }
    if (deleted > 0) {
      this.logger.log(
        `Account hard-delete: permanently deleted ${deleted} user(s).`,
      );
    }
  }
}
