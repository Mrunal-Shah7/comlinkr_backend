import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NewsService } from './news.service';
import { NewsExploreQueryDto } from './dto/news-explore-query.dto';

@ApiTags('News')
@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get('explore')
  @ApiOperation({
    summary:
      'Aggregated live news for Explore (Google News RSS via server — same mix as mobile)',
  })
  @ApiResponse({ status: 200, description: 'Deduped articles + cache timestamp' })
  async explore(@Query() query: NewsExploreQueryDto) {
    return this.newsService.getExploreFeed(
      query.city ?? '',
      query.country ?? '',
    );
  }
}
