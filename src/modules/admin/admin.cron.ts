import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

// SPRINT-51: lift expired suspensions without interfering with the Sprint 10 deletion window
// SPRINT-53: also lift conversation-scoped chat bans without touching User.isActive
@Injectable()
export class AdminCronService {
  private readonly logger = new Logger(AdminCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  // SPRINT-51: every 15 minutes — find expired, unlifted ban records and restore when safe
  @Cron('*/15 * * * *')
  async handleSuspensionExpiry() {
    const now = new Date();
    const expired = await this.prisma.banRecord.findMany({
      where: {
        liftedAt: null,
        expiresAt: { lte: now, not: null },
      },
      select: {
        id: true,
        userId: true,
        conversationId: true, // SPRINT-53: distinguish chat bans from account suspensions
      },
    });

    let lifted = 0;
    for (const ban of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          if (ban.conversationId) {
            // SPRINT-53: conversation-scoped chat ban — restore member row, never touch isActive
            await tx.conversationMember.updateMany({
              where: {
                conversationId: ban.conversationId,
                userId: ban.userId,
                blockProvenance: 'ADMIN_BAN',
              },
              data: {
                status: 'ACCEPTED',
                blockProvenance: 'NONE',
              },
            });
            await tx.banRecord.update({
              where: { id: ban.id },
              data: {
                liftedAt: now,
                liftedByAdminId: null, // SPRINT-53: automatic cron lift
              },
            });
            return;
          }

          // SPRINT-51: account-wide suspension path (unchanged)
          const user = await tx.user.findUnique({
            where: { id: ban.userId },
            select: { id: true, isActive: true, deletedAt: true },
          });
          if (!user) {
            // SPRINT-51: still mark the ban lifted so the cron does not retry forever
            await tx.banRecord.update({
              where: { id: ban.id },
              data: { liftedAt: now, liftedByAdminId: null },
            });
            return;
          }

          // SPRINT-51: account-deletion window guard — deletedAt set means Sprint 10 pending hard-delete
          const inDeletionWindow = user.deletedAt != null;
          if (!inDeletionWindow) {
            await tx.user.update({
              where: { id: user.id },
              data: { isActive: true },
            });
          }

          await tx.banRecord.update({
            where: { id: ban.id },
            data: {
              liftedAt: now,
              liftedByAdminId: null, // SPRINT-51: empty = automatic cron lift
            },
          });
        });
        lifted++;
      } catch (err) {
        this.logger.warn(`Failed to lift ban ${ban.id}: ${err}`);
      }
    }

    if (lifted > 0) {
      this.logger.log(`Suspension expiry: lifted ${lifted} ban record(s).`);
    }
  }
}
