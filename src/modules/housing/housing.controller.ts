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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HousingService } from './housing.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { HousingQueryDto } from './dto/housing-query.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

const LISTING_IMAGE_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('Housing')
@Controller('housing')
export class HousingController {
  constructor(private readonly housingService: HousingService) {}

  @Get()
  @ApiOperation({ summary: 'List housing listings with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['APARTMENT', 'HOUSE', 'CONDO', 'ROOM', 'STUDIO', 'OTHER'] })
  @ApiQuery({ name: 'minPrice', required: false })
  @ApiQuery({ name: 'maxPrice', required: false })
  @ApiQuery({ name: 'beds', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({ status: 200, description: 'Paginated listings' })
  async getListings(
    @CurrentUser('id') userId: string,
    @Query() query: HousingQueryDto,
  ) {
    return this.housingService.getListings(userId, query);
  }

  @Get('my-listings')
  @ApiOperation({ summary: "Owner's listing dashboard" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated own listings' })
  async getMyListings(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.housingService.getMyListings(userId, query);
  }

  @Get('interested')
  @ApiOperation({ summary: 'Listings the current user marked interest in' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getInterestedListings(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.housingService.getInterestedListings(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get listing by ID' })
  @ApiResponse({ status: 200, description: 'Listing detail' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async getListingById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.housingService.getListingById(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create listing (verified landlord/agency badge adds trust on the listing)' })
  @ApiResponse({ status: 201, description: 'Listing created' })
  async createListing(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateListingDto,
  ) {
    return this.housingService.createListing(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update own listing' })
  @ApiResponse({ status: 200, description: 'Listing updated' })
  @ApiResponse({ status: 403, description: 'Not owner' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async updateListing(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.housingService.updateListing(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete own listing' })
  @ApiResponse({ status: 200, description: 'Listing deleted' })
  @ApiResponse({ status: 403, description: 'Not owner' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async deleteListing(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.housingService.deleteListing(userId, id);
  }

  @Post(':id/interest')
  @ApiOperation({ summary: 'Mark interest on listing' })
  @ApiResponse({ status: 200, description: 'Interest marked' })
  @ApiResponse({ status: 400, description: 'Cannot mark interest on own listing' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async markInterest(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.housingService.markInterest(userId, id);
  }

  @Delete(':id/interest')
  @ApiOperation({ summary: 'Remove interest from listing' })
  @ApiResponse({ status: 200, description: 'Interest removed' })
  async removeInterest(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.housingService.removeInterest(userId, id);
  }

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('images', 6, {
      limits: { fileSize: LISTING_IMAGE_MAX_SIZE },
    }),
  )
  @ApiOperation({ summary: 'Upload listing images' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Images uploaded' })
  @ApiResponse({ status: 400, description: 'No files or limit exceeded' })
  @ApiResponse({ status: 403, description: 'Not owner' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async uploadImages(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const list = files ?? [];
    if (list.length === 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'No files uploaded',
      });
    }
    return this.housingService.uploadListingImages(userId, id, list);
  }

  @Delete(':id/images/:imageId')
  @ApiOperation({ summary: 'Remove listing image' })
  @ApiResponse({ status: 200, description: 'Image removed' })
  @ApiResponse({ status: 403, description: 'Not owner' })
  @ApiResponse({ status: 404, description: 'Listing or image not found' })
  async removeImage(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.housingService.removeListingImage(userId, id, imageId);
  }
}
