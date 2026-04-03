import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { StoriesCronService } from './stories.cron';

@Module({
  imports: [PrismaModule],
  controllers: [StoriesController],
  providers: [StoriesService, StoriesCronService],
})
export class StoriesModule {}

