import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { PaginationDto } from '../../common/dto/pagination.dto';
import { FoodService } from './food.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { RestaurantQueryDto } from './dto/restaurant-query.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { FoodReportReasonDto } from './dto/report-reason.dto';

const RESTAURANT_IMAGE_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('Restaurants')
@Controller('restaurants')
export class FoodController {
  constructor(private readonly foodService: FoodService) {}

  @Get()
  @ApiOperation({ summary: 'List restaurants with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'cuisine', required: false })
  @ApiQuery({ name: 'priceRange', required: false, enum: ['BUDGET', 'MODERATE', 'PREMIUM', 'LUXURY'] })
  @ApiQuery({ name: 'service', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['rating', 'distance', 'newest'] })
  @ApiResponse({ status: 200, description: 'Paginated restaurants' })
  async getRestaurants(
    @CurrentUser('id') userId: string,
    @Query() query: RestaurantQueryDto,
  ) {
    return this.foodService.getRestaurants(userId, query);
  }

  @Get('my-restaurants')
  @ApiOperation({ summary: "Owner's restaurant dashboard" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated own restaurants' })
  async getMyRestaurants(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.foodService.getMyRestaurants(userId, query);
  }

  @Get('favorites')
  @ApiOperation({ summary: "User's favorited restaurants" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated favorites' })
  async getFavorites(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.foodService.getFavorites(userId, query);
  }

  @Get('saved')
  @ApiOperation({ summary: "Get user's saved restaurants (bookmarks)" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated saved restaurants' })
  async getSavedRestaurants(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.foodService.getSavedRestaurants(userId, query);
  }

  // SPRINT-29: reservation management — literal `reservations` segment before `:id` routes
  @Patch('reservations/:reservationId/cancel')
  @ApiOperation({ summary: 'Cancel a reservation (reserver or restaurant owner)' })
  async cancelReservation(
    @CurrentUser('id') userId: string,
    @Param('reservationId') reservationId: string,
  ) {
    return this.foodService.cancelReservation(userId, reservationId);
  }

  @Patch('reservations/:reservationId/confirm')
  @ApiOperation({ summary: 'Confirm a pending reservation (owner only)' })
  async confirmReservation(
    @CurrentUser('id') userId: string,
    @Param('reservationId') reservationId: string,
  ) {
    return this.foodService.confirmReservation(userId, reservationId);
  }

  @Get(':id/reviews')
  @ApiOperation({ summary: 'Get paginated reviews for a restaurant' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated reviews' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async getReviews(
    @Param('id') id: string,
    @Query() query: PaginationDto,
  ) {
    return this.foodService.getReviews(id, query);
  }

  @Patch(':id/reviews')
  @ApiOperation({ summary: 'Edit own review' })
  @ApiResponse({ status: 200, description: 'Review updated' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @ApiResponse({ status: 400, description: 'No fields provided' })
  async updateMyReview(
    @CurrentUser('id') userId: string,
    @Param('id') restaurantId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.foodService.updateReview(userId, restaurantId, dto);
  }

  @Delete(':id/reviews')
  @ApiOperation({ summary: 'Delete own review' })
  @ApiResponse({ status: 200, description: 'Review deleted' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  async deleteMyReview(
    @CurrentUser('id') userId: string,
    @Param('id') restaurantId: string,
  ) {
    return this.foodService.deleteReview(userId, restaurantId);
  }

  // SPRINT-29: per-restaurant reservations
  @Post(':id/reservations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a reservation at a restaurant' })
  async createReservation(
    @CurrentUser('id') userId: string,
    @Param('id') restaurantId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.foodService.createReservation(userId, restaurantId, dto);
  }

  @Get(':id/reservations')
  @ApiOperation({ summary: 'List reservations for a restaurant (owner only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'CONFIRMED', 'CANCELLED'] })
  async getRestaurantReservations(
    @CurrentUser('id') userId: string,
    @Param('id') restaurantId: string,
    @Query('status') status?: string,
  ) {
    return this.foodService.getRestaurantReservations(userId, restaurantId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get restaurant by ID' })
  @ApiResponse({ status: 200, description: 'Restaurant detail' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async getRestaurantById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.foodService.getRestaurantById(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create restaurant (verified owner badge adds trust on the listing)' })
  @ApiResponse({ status: 201, description: 'Restaurant created' })
  async createRestaurant(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRestaurantDto,
  ) {
    return this.foodService.createRestaurant(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update own restaurant' })
  @ApiResponse({ status: 200, description: 'Restaurant updated' })
  @ApiResponse({ status: 403, description: 'Not owner' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async updateRestaurant(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRestaurantDto,
  ) {
    return this.foodService.updateRestaurant(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete own restaurant' })
  @ApiResponse({ status: 200, description: 'Restaurant deleted' })
  @ApiResponse({ status: 403, description: 'Not owner' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async deleteRestaurant(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.foodService.deleteRestaurant(userId, id);
  }

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('images', 6, {
      limits: { fileSize: RESTAURANT_IMAGE_MAX_SIZE },
    }),
  )
  @ApiOperation({ summary: 'Upload restaurant images' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Images uploaded' })
  @ApiResponse({ status: 400, description: 'No files or limit exceeded' })
  @ApiResponse({ status: 403, description: 'Not owner' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
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
    return this.foodService.uploadRestaurantImages(userId, id, list);
  }

  @Post(':id/reviews')
  @ApiOperation({ summary: 'Submit a review' })
  @ApiResponse({ status: 201, description: 'Review created' })
  @ApiResponse({ status: 400, description: 'Cannot review own restaurant' })
  @ApiResponse({ status: 409, description: 'Already reviewed' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async submitReview(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.foodService.submitReview(userId, id, dto);
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Submit a review (alias of POST …/reviews)' })
  async submitReviewAlias(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.foodService.submitReview(userId, id, dto);
  }

  @Post(':id/reserve')
  @ApiOperation({ summary: 'Make a reservation' })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  @ApiResponse({ status: 400, description: 'Date must be in the future' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async makeReservation(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateReservationDto,
  ) {
    return this.foodService.makeReservation(userId, id, dto);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: 'Toggle favorite' })
  @ApiResponse({ status: 200, description: 'Favorite toggled' })
  @ApiResponse({ status: 404, description: 'Restaurant not found' })
  async toggleFavorite(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.foodService.toggleFavorite(userId, id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle save/bookmark on a restaurant' })
  @ApiResponse({ status: 200, description: 'Save state' })
  async toggleRestaurantSave(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.foodService.toggleRestaurantSave(userId, id);
  }

  @Post(':id/order')
  @ApiOperation({ summary: 'Start conversation with owner (mobile “order”)' })
  async initiateOrder(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.foodService.initiateOrder(userId, id);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Report a restaurant' })
  async reportRestaurant(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: FoodReportReasonDto,
  ) {
    return this.foodService.reportRestaurant(userId, id, dto.reason);
  }
}
