import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './dto/feed-query.dto';
import { CreateFeedPostDto } from './dto/create-feed-post.dto';
import { UpdateFeedPostDto } from './dto/update-feed-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { VoteNeighborhoodMoodDto } from './dto/vote-neighborhood-mood.dto';
import { NeighborhoodMoodQueryDto } from './dto/neighborhood-mood-query.dto';

const FEED_MEDIA_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('Feed')
@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  @ApiOperation({
    summary: 'Get city-scoped feed with optional category/trending filters',
  })
  @ApiResponse({ status: 200, description: 'Paginated feed posts' })
  async getFeed(
    @CurrentUser('id') userId: string,
    @Query() query: FeedQueryDto,
  ) {
    return this.feedService.getFeed(userId, query);
  }

  @Get('mood')
  @ApiOperation({
    summary: 'Get neighborhood mood distribution for current city',
  })
  @ApiResponse({ status: 200, description: 'Mood counts and percentages' })
  async getNeighborhoodMood(
    @CurrentUser('id') userId: string,
    @Query() query: NeighborhoodMoodQueryDto,
  ) {
    return this.feedService.getNeighborhoodMood(userId, query.city);
  }

  @Post('mood')
  @ApiOperation({ summary: 'Vote your neighborhood mood for current city' })
  @ApiBody({ type: VoteNeighborhoodMoodDto })
  @ApiResponse({
    status: 200,
    description: 'Updated mood counts and percentages',
  })
  async voteNeighborhoodMood(
    @CurrentUser('id') userId: string,
    @Body() dto: VoteNeighborhoodMoodDto,
  ) {
    return this.feedService.voteNeighborhoodMood(userId, dto);
  }

  @Get('saved')
  @ApiOperation({ summary: 'Get saved/bookmarked posts for current user' })
  @ApiResponse({ status: 200, description: 'Paginated saved posts' })
  async getSavedPosts(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.feedService.getSavedPosts(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single feed post by ID' })
  @ApiResponse({ status: 200, description: 'Feed post detail' })
  async getFeedPostById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.feedService.getFeedPostById(userId, id);
  }

  @Post()
  @UseInterceptors(
    FilesInterceptor('media', 6, {
      limits: { fileSize: FEED_MEDIA_MAX_SIZE },
    }),
  )
  @ApiOperation({ summary: 'Create news feed post with optional media' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Create feed post. Send fields and optional media files in multipart/form-data',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        content: { type: 'string', maxLength: 2000 },
        category: {
          type: 'string',
          enum: [
            'COMMUNITY',
            'ANNOUNCEMENT',
            'JOBS',
            'ALERT',
            'DISCUSSION',
            'QUESTION',
            'TIP',
          ],
        },
        tags: {
          oneOf: [
            { type: 'string', description: 'Comma-separated tags' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        location: { type: 'string', maxLength: 200 },
        sourceLabel: { type: 'string', maxLength: 100 },
        media: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
      required: ['title', 'content', 'category'],
    },
  })
  @ApiResponse({ status: 201, description: 'Created post' })
  async createFeedPost(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFeedPostDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.feedService.createFeedPost(userId, dto, files ?? []);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update an owned feed post' }) // SPRINT-37: describe owner-scoped partial editing
  @ApiResponse({
    status: 200,
    description: 'Updated post in the standard feed response shape',
  }) // SPRINT-37: document successful edit response
  @ApiResponse({
    status: 400,
    description: 'No changes supplied or validation failed',
  }) // SPRINT-37: document empty/invalid partial updates
  @ApiResponse({
    status: 403,
    description: 'Only the author may edit this post',
  }) // SPRINT-37: document ownership enforcement
  @ApiResponse({ status: 404, description: 'Post not found' }) // SPRINT-37: document missing post behavior
  async updateFeedPost(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFeedPostDto,
  ) {
    return this.feedService.updateFeedPost(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete own feed post' })
  @ApiResponse({ status: 200, description: 'Post deleted' })
  async deleteFeedPost(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.feedService.deleteFeedPost(userId, id);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Toggle like on a post' })
  @ApiResponse({ status: 200, description: 'Like state and count' })
  async toggleLike(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.feedService.toggleLike(userId, id);
  }

  @Post(':id/comment')
  @ApiOperation({ summary: 'Add comment to a post' })
  @ApiResponse({ status: 201, description: 'Created comment' })
  async addComment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.feedService.addComment(userId, id, dto);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get paginated comments for a post' })
  @ApiResponse({ status: 200, description: 'Paginated comments' })
  async getComments(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.feedService.getComments(id, query);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle save/bookmark on a post' })
  @ApiResponse({ status: 200, description: 'Save state and count' })
  async toggleSave(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.feedService.toggleSave(userId, id);
  }
}
