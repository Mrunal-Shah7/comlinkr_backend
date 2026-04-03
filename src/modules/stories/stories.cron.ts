import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class StoriesCronService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  @Cron('0 * * * *')
  async handleStoryExpiry() {
    const now = new Date();
    const expired = await this.prisma.story.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true, mediaUrl: true },
    });
    for (const story of expired) {
      await this.prisma.story.delete({ where: { id: story.id } });
      if (story.mediaUrl) {
        try {
          await this.storageService.deleteFile(story.mediaUrl);
        } catch {
          // ignore
        }
      }
    }
    if (expired.length > 0) {
      console.log(`[StoriesCron] Cleaned up ${expired.length} expired story(ies)`);
    }
  }
}
