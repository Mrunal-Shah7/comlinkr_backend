import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { NewsCron } from './news.cron';

@Module({
  controllers: [NewsController],
  providers: [NewsService, NewsCron],
  exports: [NewsService],
})
export class NewsModule {}
