import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { RestaurantQueryDto } from './dto/restaurant-query.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { PaginationDto, createPaginationMeta } from '../../common/dto/pagination.dto';
import { MessagingService } from '../messaging/messaging.service';

const RESTAURANT_IMAGE_MAX = 6;
const RESTAURANT_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const RESTAURANT_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const EARTH_RADIUS_MILES = 3959;

@Injectable()
export class FoodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly messagingService: MessagingService,
  ) {}

  /**
   * Haversine formula. For production scale, consider PostGIS or a spatial index.
   */
  private computeDistanceMiles(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(EARTH_RADIUS_MILES * c * 10) / 10;
  }

  private buildFileUrl(imageUrl: string): string {
    return imageUrl;
  }

  private async getUserLocation(userId: string): Promise<{
    city: string | null;
    latitude: number | null;
    longitude: number | null;
  }> {
    const loc = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true, latitude: true, longitude: true },
    });
    return {
      city: loc?.city ?? null,
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
    };
  }

  private formatRestaurant(
    restaurant: any,
    currentUserId: string | undefined,
    userLat?: number | null,
    userLon?: number | null,
    isSavedOverride?: boolean,
  ) {
    let distanceMiles: number | null = null;
    if (
      userLat != null &&
      userLon != null &&
      restaurant.latitude != null &&
      restaurant.longitude != null
    ) {
      distanceMiles = this.computeDistanceMiles(
        userLat,
        userLon,
        restaurant.latitude,
        restaurant.longitude,
      );
    }
    const isFavorited =
      currentUserId && (restaurant.favorites?.length ?? 0) > 0;
    const isSaved =
      isSavedOverride !== undefined
        ? isSavedOverride
        : !!(currentUserId && (restaurant.saves?.length ?? 0) > 0);
    return {
      id: restaurant.id,
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      description: restaurant.description,
      address: restaurant.address,
      city: restaurant.city,
      state: restaurant.state,
      country: restaurant.country,
      phoneNumber: restaurant.phoneNumber,
      priceRange: restaurant.priceRange,
      averageRating: Number(restaurant.averageRating),
      totalReviews: restaurant.totalReviews,
      distanceMiles,
      waitTimeMinutes: restaurant.waitTimeMinutes,
      openingTime: restaurant.openingTime,
      closingTime: restaurant.closingTime,
      isOpen: restaurant.isOpen,
      isVerified: restaurant.isVerified,
      availableServices: restaurant.availableServices ?? [],
      popularDishes: (restaurant.popularDishes as any[]) ?? [],
      tags: restaurant.tags ?? [],
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
      owner: {
        id: restaurant.owner.id,
        username: restaurant.owner.username,
        name: restaurant.owner.fullName,
        avatarUrl: restaurant.owner.avatarUrl
          ? this.buildFileUrl(restaurant.owner.avatarUrl)
          : null,
        badges: (restaurant.owner.userBadges ?? []).map((b: any) => ({
          badgeType: b.badgeType,
        })),
      },
      images: (restaurant.images ?? []).map((img: any) => ({
        id: img.id,
        url: this.buildFileUrl(img.imageUrl),
        order: img.order,
      })),
      isFavorited: !!isFavorited,
      isSaved,
      isOwner: currentUserId ? restaurant.ownerId === currentUserId : false,
      latitude:
        restaurant.latitude != null ? Number(restaurant.latitude) : null,
      longitude:
        restaurant.longitude != null ? Number(restaurant.longitude) : null,
    };
  }

  async getRestaurants(userId: string, query: RestaurantQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort = query.sort ?? 'newest';
    const userLoc = await this.getUserLocation(userId);
    const cityValue = query.city ?? userLoc.city ?? undefined;

    const where: Prisma.RestaurantWhereInput = {};
    if (cityValue) {
      where.city = { contains: cityValue, mode: 'insensitive' };
    }
    if (query.cuisine) {
      where.cuisine = { contains: query.cuisine, mode: 'insensitive' };
    }
    if (query.priceRange) where.priceRange = query.priceRange;
    if (query.service) {
      where.availableServices = { has: query.service };
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { cuisine: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { tags: { has: query.search } },
      ];
    }

    const include = {
      owner: {
        include: { userBadges: { select: { badgeType: true } } },
      },
      images: { orderBy: { order: 'asc' as const } },
      favorites: userId ? { where: { userId }, select: { id: true } } : false,
      saves: userId ? { where: { userId }, select: { id: true } } : false,
    };

    if (sort === 'distance' && userLoc.latitude != null && userLoc.longitude != null) {
      const all = await this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include,
      });
      const withDistance = all.map((r) => ({
        restaurant: r,
        distance:
          r.latitude != null && r.longitude != null
            ? this.computeDistanceMiles(
                userLoc.latitude!,
                userLoc.longitude!,
                r.latitude,
                r.longitude,
              )
            : Infinity,
      }));
      withDistance.sort((a, b) => a.distance - b.distance);
      const total = withDistance.length;
      const slice = withDistance.slice((page - 1) * limit, page * limit);
      const data = slice.map(({ restaurant }) =>
        this.formatRestaurant(
          restaurant,
          userId,
          userLoc.latitude,
          userLoc.longitude,
        ),
      );
      return { data, meta: createPaginationMeta(page, limit, total) };
    }

    const orderBy: Prisma.RestaurantOrderByWithRelationInput =
      sort === 'rating'
        ? { averageRating: 'desc' }
        : { createdAt: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.restaurant.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include,
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    const data = items.map((r) =>
      this.formatRestaurant(r, userId, userLoc.latitude, userLoc.longitude),
    );
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getRestaurantById(userId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        owner: {
          include: { userBadges: { select: { badgeType: true } } },
        },
        images: { orderBy: { order: 'asc' } },
        favorites: userId ? { where: { userId }, select: { id: true } } : false,
        saves: userId ? { where: { userId }, select: { id: true } } : false,
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }

    let hasReviewed = false;
    if (userId) {
      const existing = await this.prisma.restaurantReview.findUnique({
        where: {
          restaurantId_userId: { restaurantId, userId },
        },
      });
      hasReviewed = !!existing;
    }

    const userReservations = userId
      ? await this.prisma.restaurantReservation.findMany({
          where: { restaurantId, userId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            date: true,
            time: true,
            partySize: true,
            status: true,
            createdAt: true,
          },
        })
      : [];

    const userLoc = await this.getUserLocation(userId);
    const base = this.formatRestaurant(
      restaurant,
      userId,
      userLoc.latitude,
      userLoc.longitude,
    );
    return {
      ...base,
      recentReviews: restaurant.reviews.map((r: any) => ({
        id: r.id,
        rating: r.rating,
        content: r.content,
        createdAt: r.createdAt,
        author: {
          id: r.user.id,
          username: r.user.username,
          name: r.user.fullName,
          avatarUrl: r.user.avatarUrl
            ? this.buildFileUrl(r.user.avatarUrl)
            : null,
        },
      })),
      hasReviewed,
      userReservations: userReservations.map((r) => ({
        id: r.id,
        date: r.date,
        time: r.time,
        partySize: r.partySize,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  async createRestaurant(userId: string, dto: CreateRestaurantDto) {
    const data: Prisma.RestaurantCreateInput = {
      owner: { connect: { id: userId } },
      name: dto.name,
      cuisine: dto.cuisine,
      description: dto.description,
      address: dto.address,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      latitude: dto.latitude,
      longitude: dto.longitude,
      phoneNumber: dto.phoneNumber,
      priceRange: dto.priceRange,
      waitTimeMinutes: dto.waitTimeMinutes,
      openingTime: dto.openingTime,
      closingTime: dto.closingTime,
      availableServices: dto.availableServices,
      popularDishes: JSON.parse(JSON.stringify(dto.popularDishes ?? [])),
      tags: dto.tags ?? [],
    };
    const created = await this.prisma.restaurant.create({
      data,
      include: {
        owner: {
          include: { userBadges: { select: { badgeType: true } } },
        },
        images: { orderBy: { order: 'asc' } },
        favorites: { where: { userId }, select: { id: true } },
        saves: { where: { userId }, select: { id: true } },
      },
    });
    const userLoc = await this.getUserLocation(userId);
    return this.formatRestaurant(
      created,
      userId,
      userLoc.latitude,
      userLoc.longitude,
    );
  }

  async updateRestaurant(
    userId: string,
    restaurantId: string,
    dto: UpdateRestaurantDto,
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    if (restaurant.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own restaurant',
      });
    }
    const updateData: Prisma.RestaurantUpdateInput = {};
    const fields: (keyof UpdateRestaurantDto)[] = [
      'name', 'cuisine', 'description', 'address', 'city', 'state', 'country',
      'latitude', 'longitude', 'phoneNumber', 'priceRange', 'waitTimeMinutes',
      'openingTime', 'closingTime', 'availableServices', 'popularDishes', 'tags',
      'isOpen',
    ];
    for (const key of fields) {
      const v = dto[key];
      if (v === undefined) continue;
      (updateData as any)[key] = v;
    }
    await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: updateData,
    });
    return this.getRestaurantById(userId, restaurantId);
  }

  async deleteRestaurant(userId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { images: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    if (restaurant.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only delete your own restaurant',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.restaurantSave.deleteMany({ where: { restaurantId } });
      await tx.restaurantFavorite.deleteMany({ where: { restaurantId } });
      await tx.restaurantReservation.deleteMany({ where: { restaurantId } });
      await tx.restaurantReview.deleteMany({ where: { restaurantId } });
      await tx.restaurantImage.deleteMany({ where: { restaurantId } });
      await tx.restaurant.delete({ where: { id: restaurantId } });
    });
    await Promise.all(
      restaurant.images.map(async (img) => {
        try {
          await this.storageService.deleteFile(img.imageUrl);
        } catch {
          // ignore missing objects
        }
      }),
    );
    return { message: 'Restaurant deleted' };
  }

  async uploadRestaurantImages(
    userId: string,
    restaurantId: string,
    files: Express.Multer.File[],
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { images: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    if (restaurant.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own restaurant',
      });
    }
    const existing = restaurant.images.length;
    if (existing + files.length > RESTAURANT_IMAGE_MAX) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Maximum 6 images per restaurant.',
      });
    }
    const results: Array<{ id: string; url: string; order: number }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > RESTAURANT_IMAGE_MAX_SIZE) {
        throw new BadRequestException({
          code: 'FILE_TOO_LARGE',
          message: 'Image must be under 5MB',
        });
      }
      if (!RESTAURANT_IMAGE_MIME.includes(file.mimetype)) {
        throw new BadRequestException({
          code: 'FILE_INVALID_TYPE',
          message: 'Image must be JPEG, PNG, or WebP',
        });
      }
      const extension = StorageService.extensionFromMime(file.mimetype);
      const imageUrl = await this.storageService.uploadPublicFile(
        file.buffer,
        file.mimetype,
        `restaurants/${restaurantId}`,
        randomUUID(),
        extension,
      );
      const img = await this.prisma.restaurantImage.create({
        data: { restaurantId, imageUrl, order: existing + i },
      });
      results.push({
        id: img.id,
        url: this.buildFileUrl(imageUrl),
        order: img.order,
      });
    }
    return results;
  }

  async submitReview(
    userId: string,
    restaurantId: string,
    dto: CreateReviewDto,
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, ownerId: true, averageRating: true, totalReviews: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    if (restaurant.ownerId === userId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Cannot review your own restaurant',
      });
    }
    const ownerBlockedReviewer = await this.prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId: restaurant.ownerId, blockedId: userId } },
    });
    if (ownerBlockedReviewer) {
      throw new ForbiddenException('You cannot review this restaurant.');
    }
    const existing = await this.prisma.restaurantReview.findUnique({
      where: { restaurantId_userId: { restaurantId, userId } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'DUPLICATE_ENTRY',
        message: 'You have already reviewed this restaurant.',
      });
    }
    const oldCount = restaurant.totalReviews;
    const oldAvg = Number(restaurant.averageRating);
    const newTotalReviews = oldCount + 1;
    const newAverageRating =
      oldCount === 0
        ? dto.rating
        : (oldAvg * oldCount + dto.rating) / newTotalReviews;
    const rounded = Math.round(newAverageRating * 10) / 10;

    const review = await this.prisma.$transaction(async (tx) => {
      const r = await tx.restaurantReview.create({
        data: {
          restaurantId,
          userId,
          rating: dto.rating,
          content: dto.content,
        },
      });
      await tx.restaurant.update({
        where: { id: restaurantId },
        data: {
          totalReviews: newTotalReviews,
          averageRating: rounded,
        },
      });
      return r;
    });

    const withUser = await this.prisma.restaurantReview.findUnique({
      where: { id: review.id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    return this.formatReviewResponse(withUser!);
  }

  async getReviews(restaurantId: string, query: PaginationDto) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.restaurantReview.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      }),
      this.prisma.restaurantReview.count({ where: { restaurantId } }),
    ]);
    const data = items.map((r: any) => ({
      id: r.id,
      rating: r.rating,
      content: r.content,
      createdAt: r.createdAt,
      author: {
        id: r.user.id,
        username: r.user.username,
        name: r.user.fullName,
        avatarUrl: r.user.avatarUrl
          ? this.buildFileUrl(r.user.avatarUrl)
          : null,
      },
    }));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  private formatReviewResponse(r: {
    id: string;
    rating: number;
    content: string;
    createdAt: Date;
    user: {
      id: string;
      username: string;
      fullName: string;
      avatarUrl: string | null;
    };
  }) {
    return {
      id: r.id,
      rating: r.rating,
      content: r.content,
      createdAt: r.createdAt,
      author: {
        id: r.user.id,
        username: r.user.username,
        name: r.user.fullName,
        avatarUrl: r.user.avatarUrl
          ? this.buildFileUrl(r.user.avatarUrl)
          : null,
      },
    };
  }

  async updateReview(
    userId: string,
    restaurantId: string,
    dto: UpdateReviewDto,
  ) {
    const review = await this.prisma.restaurantReview.findUnique({
      where: { restaurantId_userId: { restaurantId, userId } },
    });
    if (!review) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'You have not reviewed this restaurant',
      });
    }
    if (dto.rating === undefined && dto.content === undefined) {
      throw new BadRequestException('Provide at least one field to update');
    }
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { averageRating: true, totalReviews: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    const totalReviews = restaurant.totalReviews;
    const oldAvg = Number(restaurant.averageRating);
    const oldRating = review.rating;
    const ratingChanged =
      dto.rating !== undefined && dto.rating !== oldRating;
    let newAvgRounded = oldAvg;
    if (ratingChanged && totalReviews > 0) {
      const newRating = dto.rating as number;
      const newAvg =
        (oldAvg * totalReviews - oldRating + newRating) / totalReviews;
      newAvgRounded = Math.round(newAvg * 10) / 10;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.restaurantReview.update({
        where: { id: review.id },
        data: {
          ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
        },
      });
      if (ratingChanged) {
        await tx.restaurant.update({
          where: { id: restaurantId },
          data: { averageRating: newAvgRounded },
        });
      }
    });

    const withUser = await this.prisma.restaurantReview.findUnique({
      where: { id: review.id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    return this.formatReviewResponse(withUser!);
  }

  async deleteReview(userId: string, restaurantId: string) {
    const review = await this.prisma.restaurantReview.findUnique({
      where: { restaurantId_userId: { restaurantId, userId } },
    });
    if (!review) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'You have not reviewed this restaurant',
      });
    }
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { totalReviews: true, averageRating: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    const totalReviews = restaurant.totalReviews;
    const oldAvg = Number(restaurant.averageRating);
    const rRating = review.rating;

    await this.prisma.$transaction(async (tx) => {
      await tx.restaurantReview.delete({ where: { id: review.id } });
      if (totalReviews > 1) {
        const newAvg =
          (oldAvg * totalReviews - rRating) / (totalReviews - 1);
        const rounded = Math.round(newAvg * 10) / 10;
        await tx.restaurant.update({
          where: { id: restaurantId },
          data: {
            totalReviews: totalReviews - 1,
            averageRating: rounded,
          },
        });
      } else {
        await tx.restaurant.update({
          where: { id: restaurantId },
          data: { totalReviews: 0, averageRating: 0 },
        });
      }
    });

    return { deleted: true };
  }

  async makeReservation(
    userId: string,
    restaurantId: string,
    dto: CreateReservationDto,
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, name: true, address: true, city: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    const reservationDate = new Date(dto.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    reservationDate.setHours(0, 0, 0, 0);
    if (reservationDate.getTime() < today.getTime()) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Reservation date must be in the future',
      });
    }
    const reservation = await this.prisma.restaurantReservation.create({
      data: {
        restaurantId,
        userId,
        date: reservationDate,
        time: dto.time,
        partySize: dto.partySize,
      },
      include: { restaurant: { select: { id: true, name: true, address: true, city: true } } },
    });
    return {
      id: reservation.id,
      restaurantId: reservation.restaurantId,
      date: reservation.date,
      time: reservation.time,
      partySize: reservation.partySize,
      status: reservation.status,
      createdAt: reservation.createdAt,
      restaurant: {
        id: reservation.restaurant.id,
        name: reservation.restaurant.name,
        address: reservation.restaurant.address,
        city: reservation.restaurant.city,
      },
    };
  }

  async toggleFavorite(userId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    const existing = await this.prisma.restaurantFavorite.findUnique({
      where: {
        restaurantId_userId: { restaurantId, userId },
      },
    });
    if (existing) {
      await this.prisma.restaurantFavorite.delete({
        where: { id: existing.id },
      });
      return { favorited: false, saved: false };
    }
    await this.prisma.restaurantFavorite.create({
      data: { restaurantId, userId },
    });
    return { favorited: true, saved: true };
  }

  async reportRestaurant(
    userId: string,
    restaurantId: string,
    reason: string,
  ): Promise<{ message: string }> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, ownerId: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }

    if (restaurant.ownerId === userId) {
      throw new BadRequestException('You cannot report your own restaurant.');
    }

    await this.prisma.listingReport.create({
      data: {
        reporterId: userId,
        targetType: 'RESTAURANT',
        targetId: restaurantId,
        reason,
      },
    });
    return { message: 'Report submitted. Our team will review it shortly.' };
  }

  /** Start DM with restaurant owner (mobile “order” / inquiry). */
  async initiateOrder(userId: string, restaurantId: string) {
    const r = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, ownerId: true },
    });
    if (!r) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    if (r.ownerId === userId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Cannot start an order with your own restaurant.',
      });
    }
    const conv = await this.messagingService.createConversation(userId, {
      participantId: r.ownerId,
      contextType: 'GENERAL',
      contextId: restaurantId,
    });
    return { conversationId: conv.id };
  }

  async getFavorites(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const userLoc = await this.getUserLocation(userId);
    const [favs, total] = await this.prisma.$transaction([
      this.prisma.restaurantFavorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          restaurant: {
            include: {
              owner: { include: { userBadges: { select: { badgeType: true } } } },
              images: { orderBy: { order: 'asc' } },
              favorites: { where: { userId }, select: { id: true } },
              saves: { where: { userId }, select: { id: true } },
            },
          },
        },
      }),
      this.prisma.restaurantFavorite.count({ where: { userId } }),
    ]);
    const data = favs.map((f) =>
      this.formatRestaurant(
        f.restaurant,
        userId,
        userLoc.latitude,
        userLoc.longitude,
      ),
    );
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getMyRestaurants(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const userLoc = await this.getUserLocation(userId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.restaurant.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: { include: { userBadges: { select: { badgeType: true } } } },
          images: { orderBy: { order: 'asc' } },
          favorites: { where: { userId }, select: { id: true } },
          saves: { where: { userId }, select: { id: true } },
          _count: { select: { reviews: true, reservations: true } },
        },
      }),
      this.prisma.restaurant.count({ where: { ownerId: userId } }),
    ]);
    const data = items.map((r) =>
      this.formatRestaurant(r, userId, userLoc.latitude, userLoc.longitude),
    );
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async toggleRestaurantSave(userId: string, restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true },
    });
    if (!restaurant) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Restaurant not found',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.restaurantSave.findUnique({
        where: {
          userId_restaurantId: { userId, restaurantId },
        },
      });
      if (existing) {
        await tx.restaurantSave.delete({ where: { id: existing.id } });
        return { saved: false };
      }
      await tx.restaurantSave.create({
        data: { userId, restaurantId },
      });
      return { saved: true };
    });
  }

  async getSavedRestaurants(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const userLoc = await this.getUserLocation(userId);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.restaurantSave.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          restaurant: {
            include: {
              owner: { include: { userBadges: { select: { badgeType: true } } } },
              images: { orderBy: { order: 'asc' } },
              favorites: { where: { userId }, select: { id: true } },
              saves: { where: { userId }, select: { id: true } },
            },
          },
        },
      }),
      this.prisma.restaurantSave.count({ where: { userId } }),
    ]);
    const data = rows.map((row) =>
      this.formatRestaurant(
        row.restaurant,
        userId,
        userLoc.latitude,
        userLoc.longitude,
        true,
      ),
    );
    return { data, meta: createPaginationMeta(page, limit, total) };
  }
}


