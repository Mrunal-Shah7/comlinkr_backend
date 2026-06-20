import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';

@Module({
  imports: [PrismaModule],
  providers: [FeedService],
  controllers: [FeedController],
})
export class FeedModule {}
