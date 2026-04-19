import {
  BadRequestException,
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
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SharedSpacesService } from './shared-spaces.service';
import { CreateSharedSpaceDto } from './dto/create-shared-space.dto';
import { UpdateSharedSpaceDto } from './dto/update-shared-space.dto';
import { SharedSpacesQueryDto } from './dto/shared-spaces-query.dto';
import { ApplySharedSpaceDto } from './dto/apply-shared-space.dto';

const UPLOAD_MAX = 5 * 1024 * 1024;

@ApiTags('Shared Spaces')
@Controller('shared-spaces')
export class SharedSpacesController {
  constructor(private readonly sharedSpacesService: SharedSpacesService) {}

  @Get()
  @ApiOperation({ summary: 'List shared spaces (paginated)' })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'maxPrice', required: false })
  @ApiQuery({ name: 'petFriendly', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(@CurrentUser('id') userId: string, @Query() query: SharedSpacesQueryDto) {
    return this.sharedSpacesService.getSharedSpaces(userId, query);
  }

  @Get('me')
  @ApiOperation({ summary: 'Current user shared spaces' })
  mySpaces(@CurrentUser('id') userId: string) {
    return this.sharedSpacesService.getMySharedSpaces(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shared space by id' })
  getOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.sharedSpacesService.getSharedSpaceById(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create shared space' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateSharedSpaceDto) {
    return this.sharedSpacesService.createSharedSpace(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update own shared space' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSharedSpaceDto,
  ) {
    return this.sharedSpacesService.updateSharedSpace(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete own shared space' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.sharedSpacesService.deleteSharedSpace(userId, id);
  }

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('images', 6, {
      limits: { fileSize: UPLOAD_MAX },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload shared space images' })
  async uploadImages(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const list = files ?? [];
    if (list.length === 0) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'No files uploaded' });
    }
    return this.sharedSpacesService.uploadImages(userId, id, list);
  }

  @Delete(':id/images/:imageId')
  @ApiOperation({ summary: 'Remove a shared space image' })
  removeImage(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.sharedSpacesService.deleteImage(userId, id, imageId);
  }

  @Post(':id/apply')
  @ApiOperation({ summary: 'Apply to join shared space' })
  apply(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ApplySharedSpaceDto,
  ) {
    return this.sharedSpacesService.applyToSpace(userId, id, dto.message);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle save / bookmark' })
  toggleSave(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.sharedSpacesService.toggleSave(userId, id);
  }
}
