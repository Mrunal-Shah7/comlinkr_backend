import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { NewsService } from './news.service';
import { NewsExploreQueryDto } from './dto/news-explore-query.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AddNewsCommentDto } from './dto/add-news-comment.dto';

@ApiTags('News')
@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get('explore')
  @ApiOperation({
    summary:
      'Aggregated live news for Explore (Google News RSS via server — same mix as mobile)',
  })
  @ApiQuery({ name: 'phase', required: false, enum: ['primary', 'full'] })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Deduped articles + cache timestamp' })
  async explore(@Query() query: NewsExploreQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const force = query.force === true;
    if (query.phase === 'primary') {
      return this.newsService.getExploreFeedPrimary(query.city ?? '', query.country ?? '', page, pageSize, force);
    }
    return this.newsService.getExploreFeed(query.city ?? '', query.country ?? '', page, pageSize, force);
  }

  @Get('articles/:id/stats')
  @UseGuards(AuthGuard)
  getArticleStats(
    @CurrentUser('id') userId: string,
    @Param('id') articleId: string,
  ) {
    return this.newsService.getArticleStats(userId, articleId);
  }

  @Post('articles/:id/like')
  @UseGuards(AuthGuard)
  toggleArticleLike(
    @CurrentUser('id') userId: string,
    @Param('id') articleId: string,
  ) {
    return this.newsService.toggleArticleLike(userId, articleId);
  }

  @Get('articles/:id/comments')
  @UseGuards(AuthGuard)
  getArticleComments(
    @CurrentUser('id') userId: string,
    @Param('id') articleId: string,
    @Query() query: PaginationDto,
  ) {
    return this.newsService.getArticleComments(userId, articleId, query);
  }

  @Post('articles/:id/comments')
  @UseGuards(AuthGuard)
  addArticleComment(
    @CurrentUser('id') userId: string,
    @Param('id') articleId: string,
    @Body() dto: AddNewsCommentDto,
  ) {
    return this.newsService.addArticleComment(userId, articleId, dto);
  }
}
