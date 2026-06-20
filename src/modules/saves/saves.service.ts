import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RoommatesService } from '../roommates/roommates.service';
import {
  PaginationDto,
  createPaginationMeta,
} from '../../common/dto/pagination.dto';
import type { SavesQueryDto } from './dto/saves-query.dto';

const EARTH_RADIUS_MILES = 3959;

@Injectable()
export class SavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly roommatesService: RoommatesService,
  ) {}

  private buildFileUrl(url: string): string {
    return url;
  }

  private async buildEventImageUrl(
    imageUrl: string | null | undefined,
  ): Promise<string> {
    if (imageUrl == null || imageUrl === '') return '';
    return this.storageService.getReadUrlForClient(imageUrl);
  }

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

  private formatFeedPost(post: any, userId: string) {
    const isLiked = (post.likes?.length ?? 0) > 0;
    const isSaved = (post.saves?.length ?? 0) > 0;
    return {
      id: post.id,
      title: post.title,
      content: post.content,
      category: post.category,
      tags: post.tags,
      location: post.location,
      sourceLabel: post.sourceLabel,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      savesCount: post.savesCount,
      isPublished: post.isPublished,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: {
        id: post.author.id,
        username: post.author.username,
        name: post.author.fullName,
        avatarUrl: post.author.avatarUrl
          ? this.buildFileUrl(post.author.avatarUrl)
          : null,
      },
      media: (post.media ?? []).map((m: any) => ({
        id: m.id,
        url: this.buildFileUrl(m.imageUrl),
        order: m.order,
      })),
      isLiked,
      isSaved,
      isOwner: post.authorId === userId,
    };
  }

  private formatListing(
    listing: any,
    userId: string,
    isSavedOverride: boolean,
  ) {
    const isInterested = (listing.interests?.length ?? 0) > 0;
    const interestCount =
      listing._count?.interests ?? listing.interests?.length ?? 0;
    return {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      propertyType: listing.propertyType,
      price: Number(listing.price),
      currency: listing.currency,
      deposit: listing.deposit != null ? Number(listing.deposit) : null,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      sqft: listing.sqft,
      floor: listing.floor,
      address: listing.address,
      neighborhood: listing.neighborhood,
      city: listing.city,
      state: listing.state,
      country: listing.country,
      availableDate: listing.availableDate,
      leaseTerm: listing.leaseTerm,
      isFurnished: listing.isFurnished,
      petPolicy: listing.petPolicy,
      parking: listing.parking,
      laundry: listing.laundry,
      heating: listing.heating,
      cooling: listing.cooling,
      utilities: listing.utilities,
      yearBuilt: listing.yearBuilt,
      amenities: listing.amenities ?? [],
      transitInfo: listing.transitInfo,
      walkScore: listing.walkScore,
      isVerified: listing.isVerified,
      isFeatured: listing.isFeatured,
      status: listing.status,
      viewsCount: listing.viewsCount,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
      owner: {
        id: listing.owner.id,
        username: listing.owner.username,
        name: listing.owner.fullName,
        avatarUrl: listing.owner.avatarUrl
          ? this.buildFileUrl(listing.owner.avatarUrl)
          : null,
        badges: (listing.owner.userBadges ?? []).map((b: any) => ({
          badgeType: b.badgeType,
        })),
      },
      images: (listing.images ?? []).map((img: any) => ({
        id: img.id,
        url: this.buildFileUrl(img.imageUrl),
        order: img.order,
        caption: img.caption,
      })),
      isInterested: !!isInterested,
      interestCount,
      isSaved: isSavedOverride,
      isOwner: listing.ownerId === userId,
    };
  }

  private formatRestaurant(
    restaurant: any,
    userId: string,
    userLat: number | null,
    userLon: number | null,
    isSavedOverride: boolean,
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
    const isFavorited = (restaurant.favorites?.length ?? 0) > 0;
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
      isSaved: isSavedOverride,
      isOwner: restaurant.ownerId === userId,
    };
  }

  private formatQuestion(
    question: any,
    userId: string,
    upvotedIds: Set<string>,
    savedIds: Set<string>,
  ) {
    return {
      id: question.id,
      title: question.title,
      body: question.body,
      category: question.category,
      tags: question.tags,
      upvoteCount: question.upvoteCount,
      answerCount: question.answerCount,
      city: question.city,
      createdAt: question.createdAt,
      author: {
        id: question.author.id,
        username: question.author.username,
        name: question.author.fullName,
        avatarUrl: question.author.avatarUrl ?? null,
      },
      isUpvoted: upvotedIds.has(question.id),
      isSaved: savedIds.has(question.id),
      isOwner: question.authorId === userId,
    };
  }

  private formatStory(story: any, isSavedOverride: boolean) {
    const now = new Date();
    const isExpired = story.expiresAt < now;
    return {
      id: story.id,
      title: story.title,
      mediaType: story.mediaType,
      category: story.category,
      details: story.details,
      hashtags: story.hashtags ?? [],
      durationSeconds: story.durationSeconds,
      location: story.location,
      mediaUrl: story.mediaUrl,
      viewsCount: story.viewsCount,
      expiresAt: story.expiresAt,
      createdAt: story.createdAt,
      isExpired,
      isSaved: isSavedOverride,
      author: {
        id: story.author.id,
        username: story.author.username,
        name: story.author.fullName,
        avatarUrl: story.author.avatarUrl
          ? this.buildFileUrl(story.author.avatarUrl)
          : null,
      },
    };
  }

  private async formatEvent(event: any, userId: string) {
    const attendeeCount = event.attendeeCount ?? event._count?.attendees ?? 0;
    const capacity = event.capacity;
    const isFull = capacity != null && attendeeCount >= capacity;
    const spotsLeft =
      capacity != null ? Math.max(0, capacity - attendeeCount) : null;
    const isAttending = (event.attendees?.length ?? 0) > 0;
    const isSaved = (event.saves?.length ?? 0) > 0;
    const imageRows = event.eventImages ?? [];
    const sortedImages = [...imageRows].sort(
      (a: { order: number }, b: { order: number }) => a.order - b.order,
    );
    const images = (
      await Promise.all(
        sortedImages.map((row: { imageUrl: string | null }) =>
          this.buildEventImageUrl(row.imageUrl),
        ),
      )
    ).filter((u) => u.length > 0);
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      category: event.category,
      format: event.format,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      venue: event.venue,
      city: event.city,
      ticketType: event.ticketType,
      ticketPrice: event.ticketPrice != null ? Number(event.ticketPrice) : null,
      capacity: event.capacity,
      attendeeCount,
      createdAt: event.createdAt,
      images,
      author: {
        id: event.author.id,
        username: event.author.username,
        name: event.author.fullName,
        avatarUrl: event.author.avatarUrl
          ? await this.buildEventImageUrl(event.author.avatarUrl)
          : null,
        badges: (event.author.userBadges ?? []).map(
          (b: { badgeType: string }) => ({
            badgeType: b.badgeType,
          }),
        ),
      },
      isAttending: !!isAttending,
      registeredByMe: !!isAttending,
      savedByMe: isSaved,
      isSaved,
      isFull,
      isOwner: event.authorId === userId,
      spotsLeft,
      conversationId: event.conversationId ?? null,
      canAccessChat: !!(
        event.conversationId &&
        (event.authorId === userId || !!isAttending)
      ),
    };
  }

  async getAllSaves(userId: string, query: SavesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    if (!query.type) {
      const [news, events, listings, food, community, stories, roommates] =
        await Promise.all([
          this.prisma.newsArticleSave.count({ where: { userId } }), // SPRINT-30: live news article saves
          this.prisma.eventSave.count({ where: { userId } }),
          this.prisma.housingSave.count({ where: { userId } }),
          this.prisma.restaurantSave.count({ where: { userId } }),
          this.prisma.communitySave.count({ where: { userId } }),
          this.prisma.storySave.count({ where: { userId } }),
          this.prisma.roommateSave.count({ where: { userId } }),
        ]);
      return {
        counts: {
          news,
          events,
          listings,
          food,
          community,
          stories,
          roommates,
        },
      };
    }

    switch (query.type) {
      case 'news': {
        const [rows, total] = await this.prisma.$transaction([
          this.prisma.feedSave.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              feedPost: {
                include: {
                  author: true,
                  media: true,
                  likes: { where: { userId }, select: { id: true } },
                  saves: { where: { userId }, select: { id: true } },
                },
              },
            },
          }),
          this.prisma.feedSave.count({ where: { userId } }),
        ]);
        const data = rows.map((r) => ({
          savedItemType: 'news' as const,
          savedAt: r.createdAt,
          ...this.formatFeedPost(r.feedPost as any, userId),
        }));
        return { data, meta: createPaginationMeta(page, limit, total) };
      }
      case 'events': {
        const [rows, total] = await this.prisma.$transaction([
          this.prisma.eventSave.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              event: {
                include: {
                  author: {
                    select: {
                      id: true,
                      username: true,
                      fullName: true,
                      avatarUrl: true,
                      userBadges: { select: { badgeType: true } },
                    },
                  },
                  attendees: { where: { userId }, select: { id: true } },
                  saves: { where: { userId }, select: { id: true } },
                  eventImages: { orderBy: { order: 'asc' } },
                },
              },
            },
          }),
          this.prisma.eventSave.count({ where: { userId } }),
        ]);
        const data = await Promise.all(
          rows.map(async (r) => ({
            savedItemType: 'event' as const,
            savedAt: r.createdAt,
            ...(await this.formatEvent(r.event, userId)),
          })),
        );
        return { data, meta: createPaginationMeta(page, limit, total) };
      }
      case 'listings': {
        const [rows, total] = await this.prisma.$transaction([
          this.prisma.housingSave.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              listing: {
                include: {
                  owner: {
                    include: { userBadges: { select: { badgeType: true } } },
                  },
                  images: { orderBy: { order: 'asc' } },
                  _count: { select: { interests: true } },
                  interests: {
                    where: { userId },
                    select: { id: true },
                  },
                  saves: {
                    where: { userId },
                    select: { id: true },
                  },
                },
              },
            },
          }),
          this.prisma.housingSave.count({ where: { userId } }),
        ]);
        const data = rows.map((r) => {
          const listing = r.listing;
          const withCount = {
            ...listing,
            interestCount: listing._count.interests,
          };
          return {
            savedItemType: 'listing' as const,
            savedAt: r.createdAt,
            ...this.formatListing(withCount, userId, true),
          };
        });
        return { data, meta: createPaginationMeta(page, limit, total) };
      }
      case 'food': {
        const loc = await this.prisma.userLocation.findUnique({
          where: { userId },
          select: { latitude: true, longitude: true },
        });
        const userLat = loc?.latitude ?? null;
        const userLon = loc?.longitude ?? null;
        const [rows, total] = await this.prisma.$transaction([
          this.prisma.restaurantSave.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              restaurant: {
                include: {
                  owner: {
                    include: { userBadges: { select: { badgeType: true } } },
                  },
                  images: { orderBy: { order: 'asc' } },
                  favorites: { where: { userId }, select: { id: true } },
                  saves: { where: { userId }, select: { id: true } },
                },
              },
            },
          }),
          this.prisma.restaurantSave.count({ where: { userId } }),
        ]);
        const data = rows.map((r) => ({
          savedItemType: 'food' as const,
          savedAt: r.createdAt,
          ...this.formatRestaurant(
            r.restaurant,
            userId,
            userLat,
            userLon,
            true,
          ),
        }));
        return { data, meta: createPaginationMeta(page, limit, total) };
      }
      case 'community': {
        const [rows, total] = await this.prisma.$transaction([
          this.prisma.communitySave.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              question: { include: { author: true } },
            },
          }),
          this.prisma.communitySave.count({ where: { userId } }),
        ]);
        const ids = rows.map((r) => r.question.id);
        const upvotes =
          ids.length === 0
            ? []
            : await this.prisma.communityUpvote.findMany({
                where: {
                  userId,
                  targetType: 'QUESTION',
                  targetId: { in: ids },
                },
                select: { targetId: true },
              });
        const upvotedIds = new Set(upvotes.map((u) => u.targetId));
        const savedIds = new Set(ids);
        const data = rows.map((r) => ({
          savedItemType: 'community_question' as const,
          savedAt: r.createdAt,
          ...this.formatQuestion(r.question, userId, upvotedIds, savedIds),
        }));
        return { data, meta: createPaginationMeta(page, limit, total) };
      }
      case 'stories': {
        const [rows, total] = await this.prisma.$transaction([
          this.prisma.storySave.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              story: {
                include: {
                  author: {
                    select: {
                      id: true,
                      username: true,
                      fullName: true,
                      avatarUrl: true,
                    },
                  },
                  saves: { where: { userId }, select: { id: true } },
                },
              },
            },
          }),
          this.prisma.storySave.count({ where: { userId } }),
        ]);
        const data = rows.map((r) => ({
          savedItemType: 'story' as const,
          savedAt: r.createdAt,
          ...this.formatStory(r.story, true),
        }));
        return { data, meta: createPaginationMeta(page, limit, total) };
      }
      case 'roommates': {
        const pagination: PaginationDto = { page, limit, _: undefined };
        const res = await this.roommatesService.getSavedRoommates(
          userId,
          pagination,
        );
        const ids = res.data.map((c: { id: string }) => c.id);
        const saveMeta =
          ids.length === 0
            ? []
            : await this.prisma.roommateSave.findMany({
                where: { userId, savedUserId: { in: ids } },
                select: { savedUserId: true, createdAt: true },
              });
        const savedAtByUser = new Map(
          saveMeta.map((s) => [s.savedUserId, s.createdAt]),
        );
        const data = res.data.map((card: any) => ({
          savedItemType: 'roommate' as const,
          savedAt: savedAtByUser.get(card.id) ?? new Date(0),
          ...card,
        }));
        return { data, meta: res.meta };
      }
      default:
        return { data: [], meta: createPaginationMeta(page, limit, 0) };
    }
  }
}
