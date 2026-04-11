import {
  Body,
  Controller,
  Get,
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
import { PaginationDto } from '../../common/dto/pagination.dto';
import { StoriesService } from './stories.service';
import { CreateStoryDto } from './dto/create-story.dto';

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
}
