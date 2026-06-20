import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NewsService } from './news.service';

@Injectable()
export class NewsCron {
  private readonly logger = new Logger(NewsCron.name);

  constructor(private readonly newsService: NewsService) {}

  @Cron('*/4 * * * *')
  async warmNewsCache() {
    try {
      const locations = this.newsService.getActiveLocations();
      if (locations.length === 0) {
        this.logger.log('No active locations to warm');
        return;
      }

      const results = await Promise.allSettled(
        locations.map((location) => {
          const [city = '', country = ''] = location.split('|');
          return this.newsService.getExploreFeed(city, country);
        }),
      );
      const failed = results.filter((res) => res.status === 'rejected');
      this.logger.log(`Warmed ${locations.length} locations`);
      if (failed.length > 0) {
        failed.forEach((res, index) => {
          if (res.status === 'rejected') {
            this.logger.warn(
              `Warm failed for location index ${index}: ${res.reason}`,
            );
          }
        });
      }
    } catch (error) {
      this.logger.error(
        `Cache warm failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
