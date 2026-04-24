import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';
import { AddStoryCommentDto } from './dto/add-story-comment.dto';

const STORY_MEDIA_MAX_SIZE = 10 * 1024 * 1024;

@ApiTags('Stories')
@Controller('stories')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('media', {
      limits: { fileSize: STORY_MEDIA_MAX_SIZE },
    }),
  )
  @ApiOperation({ summary: 'Create story (multipart: fields + media)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Story created' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  async createStory(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateStoryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.storiesService.createStory(userId, dto, file);
  }

  /** Must be before @Get(':id') so "me" is not parsed as an id. */
  @Get('me')
  @ApiOperation({ summary: 'Current user’s active stories' })
  @ApiResponse({ status: 200, description: 'Array of active stories for the viewer' })
  async getMyStories(@CurrentUser('id') userId: string) {
    return this.storiesService.getMyStories(userId);
  }

  /** Must be before @Get(':id'). */
  @Get('saved')
  @ApiOperation({ summary: "Get user's saved stories" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated saved stories' })
  async getSavedStories(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.storiesService.getSavedStories(userId, query);
  }

  @Get()
  @ApiOperation({ summary: 'Active stories in user\'s city' })
  @ApiResponse({ status: 200, description: 'Array of active stories' })
  async getActiveStories(@CurrentUser('id') userId: string) {
    return this.storiesService.getActiveStories(userId);
  }

  /** Before @Get(':id') — paginated comments (public). */
  @Public()
  @Get(':id/comments')
  @ApiOperation({ summary: 'Paginated comments for a story' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Comments' })
  async getComments(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.storiesService.getStoryComments(id, query);
  }

  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a comment to a story' })
  @ApiResponse({ status: 201, description: 'Comment created' })
  async addComment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: AddStoryCommentDto,
  ) {
    return this.storiesService.addStoryComment(userId, id, dto);
  }

  @Delete(':id/comments/:commentId')
  @ApiOperation({ summary: 'Delete a story comment' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  async deleteComment(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.storiesService.deleteStoryComment(userId, id, commentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View a story (increments view count)' })
  @ApiResponse({ status: 200, description: 'Story detail' })
  @ApiResponse({ status: 404, description: 'Not found or expired' })
  async viewStory(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.storiesService.viewStory(userId, id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle save/bookmark on a story' })
  @ApiResponse({ status: 200, description: 'Save state' })
  async toggleStorySave(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.storiesService.toggleStorySave(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete own story (before or after expiry if still stored)' })
  @ApiResponse({ status: 200, description: 'Story removed' })
  @ApiResponse({ status: 403, description: 'Not the author' })
  async deleteStory(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.storiesService.deleteStory(userId, id);
  }
}
