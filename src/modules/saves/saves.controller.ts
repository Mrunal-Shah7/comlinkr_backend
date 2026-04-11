import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SavesService } from './saves.service';
import { SavesQueryDto } from './dto/saves-query.dto';

@ApiTags('Saves')
@Controller('saves')
export class SavesController {
  constructor(private readonly savesService: SavesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Unified saved items: counts only when `type` is omitted; paginated list when `type` is set',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: [
      'news',
      'events',
      'listings',
      'food',
      'community',
      'stories',
      'roommates',
    ],
    description:
      'Filter by content type. Omit for aggregate counts across all types.',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getSaves(
    @CurrentUser('id') userId: string,
    @Query() query: SavesQueryDto,
  ) {
    return this.savesService.getAllSaves(userId, query);
  }
}
