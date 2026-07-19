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
  ApiBody, // SPRINT-37: document complete image reorder request bodies
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HousingService, LISTING_IMAGE_MAX } from './housing.service'; // SPRINT-37: use one shared listing image maximum
import { CreateListingDto } from './dto/create-listing.dto';
import { CreateListingReportDto } from './dto/create-listing-report.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { HousingQueryDto } from './dto/housing-query.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ReorderListingImagesDto } from './dto/reorder-listing-images.dto'; // SPRINT-37: validate complete desired image order

const LISTING_IMAGE_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('Housing')
@Controller('housing')
export class HousingController {
  constructor(private readonly housingService: HousingService) {}

  @Get()
  @ApiOperation({ summary: 'List housing listings with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['APARTMENT', 'HOUSE', 'CONDO', 'ROOM', 'STUDIO', 'OTHER'],
  })
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

  @Get('saved')
  @ApiOperation({ summary: "Get user's saved listings" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated saved listings' })
  async getSavedListings(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.housingService.getSavedListings(userId, query);
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

  @Post(':id/report')
  @ApiOperation({ summary: 'Report a housing listing' })
  async reportListing(
    @CurrentUser('id') userId: string,
    @Param('id') listingId: string,
    @Body() dto: CreateListingReportDto,
  ) {
    return this.housingService.reportListing(userId, listingId, dto.reason);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create listing (verified landlord/agency badge adds trust on the listing)',
  })
  @ApiResponse({ status: 201, description: 'Listing created' })
  async createListing(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateListingDto,
  ) {
    return this.housingService.createListing(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update an owned housing listing' }) // SPRINT-37: describe owner-scoped partial field editing
  @ApiResponse({
    status: 200,
    description: 'Updated listing in the standard response shape',
  }) // SPRINT-37: document successful edit response
  @ApiResponse({
    status: 400,
    description: 'No changes supplied or validation failed',
  }) // SPRINT-37: document empty/invalid partial updates
  @ApiResponse({
    status: 403,
    description: 'Only the owner may edit this listing',
  }) // SPRINT-37: document ownership enforcement
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async updateListing(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.housingService.updateListing(userId, id, dto);
  }

  @Post(':id/images') // SPRINT-37: keep owner image operations grouped immediately after field editing
  @UseInterceptors(
    // SPRINT-37: reuse the existing direct multipart image mechanism
    FilesInterceptor('images', LISTING_IMAGE_MAX, {
      // SPRINT-37: share the same six-image limit as service capacity validation
      limits: { fileSize: LISTING_IMAGE_MAX_SIZE }, // SPRINT-37: preserve the existing five MiB per-file ceiling
    }), // SPRINT-37: complete multipart interceptor configuration
  ) // SPRINT-37: complete image upload interceptor
  @ApiOperation({ summary: 'Append images to an owned listing' }) // SPRINT-37: describe owner-scoped image addition
  @ApiConsumes('multipart/form-data') // SPRINT-37: publish the existing direct-file upload contract
  @ApiBody({
    // SPRINT-37: document the established multipart field explicitly
    schema: {
      // SPRINT-37: define the direct-file request body
      type: 'object', // SPRINT-37: represent the multipart form
      properties: {
        // SPRINT-37: enumerate accepted form fields
        images: {
          // SPRINT-37: retain the mobile client's existing field name
          type: 'array', // SPRINT-37: accept a batch of images
          maxItems: LISTING_IMAGE_MAX, // SPRINT-37: publish the shared per-listing maximum
          items: { type: 'string', format: 'binary' }, // SPRINT-37: represent each uploaded image file
        }, // SPRINT-37: complete image field schema
      }, // SPRINT-37: complete multipart properties
      required: ['images'], // SPRINT-37: require at least one multipart image field
    }, // SPRINT-37: complete multipart body schema
  }) // SPRINT-37: complete upload Swagger body
  @ApiResponse({
    status: 201,
    description: 'Complete ordered listing image collection',
  }) // SPRINT-37: document ordered response
  @ApiResponse({
    status: 400,
    description: 'No files, invalid files, or six-image limit exceeded',
  }) // SPRINT-37: document upload validation
  @ApiResponse({ status: 403, description: 'Only the owner may add images' }) // SPRINT-37: document ownership enforcement
  @ApiResponse({ status: 404, description: 'Listing not found' }) // SPRINT-37: document missing listing behavior
  async uploadImages(
    // SPRINT-37: retain the existing mobile-compatible upload route
    @CurrentUser('id') userId: string, // SPRINT-37: derive actor identity from the authenticated session
    @Param('id') id: string, // SPRINT-37: identify the owner-verified listing
    @UploadedFiles() files: Express.Multer.File[], // SPRINT-37: receive direct multipart image files
  ) {
    // SPRINT-37: complete upload route signature
    const list = files ?? []; // SPRINT-37: normalize absent multipart files
    if (list.length === 0) {
      // SPRINT-37: reject an empty upload before service invocation
      throw new BadRequestException({
        // SPRINT-37: return the established structured error
        code: 'BAD_REQUEST', // SPRINT-37: identify invalid input
        message: 'No files uploaded', // SPRINT-37: state the missing-file condition
      }); // SPRINT-37: complete empty-upload error
    } // SPRINT-37: complete controller file gate
    return this.housingService.uploadListingImages(userId, id, list); // SPRINT-37: append through owner-checked service logic
  } // SPRINT-37: complete add-images route

  @Delete(':id/images/:imageId') // SPRINT-37: expose owner-scoped removal under the nested image path
  @ApiOperation({ summary: 'Remove one image from an owned listing' }) // SPRINT-37: describe image removal
  @ApiResponse({
    status: 200,
    description: 'Remaining images in contiguous stored order',
  }) // SPRINT-37: document ordered remainder
  @ApiResponse({ status: 403, description: 'Only the owner may remove images' }) // SPRINT-37: document ownership enforcement
  @ApiResponse({ status: 404, description: 'Listing or image not found' }) // SPRINT-37: document cross-listing/missing image behavior
  async removeImage(
    // SPRINT-37: retain the established nested removal route
    @CurrentUser('id') userId: string, // SPRINT-37: derive actor identity from the authenticated session
    @Param('id') id: string, // SPRINT-37: identify the owner-verified listing
    @Param('imageId') imageId: string, // SPRINT-37: identify the image whose listing membership is verified
  ) {
    // SPRINT-37: complete remove route signature
    return this.housingService.removeListingImage(userId, id, imageId); // SPRINT-37: delete, clean storage, renumber, and return remainder
  } // SPRINT-37: complete remove-image route

  @Patch(':id/images/reorder') // SPRINT-37: accept a complete idempotent desired ordering
  @ApiOperation({
    summary: 'Set the complete image order for an owned listing',
  }) // SPRINT-37: describe full-list reorder semantics
  @ApiBody({ type: ReorderListingImagesDto }) // SPRINT-37: publish the ordered identifier array contract
  @ApiResponse({
    status: 200,
    description: 'Images in their newly persisted order',
  }) // SPRINT-37: document successful reorder
  @ApiResponse({
    status: 400,
    description: 'Ordering is missing, extra, or duplicated',
  }) // SPRINT-37: document exact-set validation
  @ApiResponse({
    status: 403,
    description: 'Only the owner may reorder images',
  }) // SPRINT-37: document ownership enforcement
  @ApiResponse({ status: 404, description: 'Listing not found' }) // SPRINT-37: document missing listing behavior
  async reorderImages(
    // SPRINT-37: expose the new complete-order operation
    @CurrentUser('id') userId: string, // SPRINT-37: derive actor identity from the authenticated session
    @Param('id') id: string, // SPRINT-37: identify the owner-verified listing
    @Body() dto: ReorderListingImagesDto, // SPRINT-37: receive validated complete image identifiers
  ) {
    // SPRINT-37: complete reorder route signature
    return this.housingService.reorderListingImages(userId, id, dto.imageIds); // SPRINT-37: persist atomically after service ownership/set checks
  } // SPRINT-37: complete reorder-images route

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
  @ApiResponse({
    status: 400,
    description: 'Cannot mark interest on own listing',
  })
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

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle save/bookmark on a listing' })
  @ApiResponse({ status: 200, description: 'Save state' })
  async toggleSave(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.housingService.toggleSave(userId, id);
  }
}
