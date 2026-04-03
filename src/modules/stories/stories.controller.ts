import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
}
