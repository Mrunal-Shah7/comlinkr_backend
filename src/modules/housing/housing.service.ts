import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { HousingQueryDto } from './dto/housing-query.dto';
import { PaginationDto, createPaginationMeta } from '../../common/dto/pagination.dto';

const LISTING_IMAGE_MAX = 6;
const LISTING_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const LISTING_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class HousingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  private buildFileUrl(imageUrl: string): string {
    return imageUrl;
  }

  private async getUserCity(userId: string): Promise<string | null> {
    const loc = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    return loc?.city ?? null;
  }

  private formatListing(
    listing: any,
    currentUserId?: string,
    isSavedOverride?: boolean,
  ) {
    const isInterested =
      currentUserId && (listing.interests?.length ?? 0) > 0;
    const interestCount =
      listing._count?.interests ?? listing.interests?.length ?? 0;
    const isSaved =
      isSavedOverride !== undefined
        ? isSavedOverride
        : !!(currentUserId && (listing.saves?.length ?? 0) > 0);

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
      isSaved,
      isOwner: currentUserId ? listing.ownerId === currentUserId : false,
    };
  }

  async getListings(userId: string, query: HousingQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    let city: string | null = query.city ?? null;
    if (!city) {
      city = await this.getUserCity(userId);
    }

    const where: Prisma.HousingListingWhereInput = {
      status: 'AVAILABLE',
    };
    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }
    if (query.type) where.propertyType = query.type;
    if (query.minPrice != null || query.maxPrice != null) {
      where.price = {};
      if (query.minPrice != null) (where.price as any).gte = query.minPrice;
      if (query.maxPrice != null) (where.price as any).lte = query.maxPrice;
    }
    if (query.beds != null) where.bedrooms = { gte: query.beds };
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { address: { contains: query.search, mode: 'insensitive' } },
        { neighborhood: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.housingListing.findMany({
        where,
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
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
      }),
      this.prisma.housingListing.count({ where }),
    ]);

    const data = items.map((listing) => {
      const listingWithCount = { ...listing, interestCount: listing._count.interests };
      return this.formatListing(listingWithCount, userId);
    });
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getInterestedListings(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [interests, total] = await this.prisma.$transaction([
      this.prisma.housingInterest.findMany({
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
      this.prisma.housingInterest.count({ where: { userId } }),
    ]);

    const data = interests.map((row) => {
      const listing = row.listing;
      const withCount = { ...listing, interestCount: listing._count.interests };
      return this.formatListing(withCount, userId);
    });
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getListingById(userId: string, listingId: string) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
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
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    this.prisma.housingListing
      .update({
        where: { id: listingId },
        data: { viewsCount: { increment: 1 } },
      })
      .catch(() => {});
    const withCount = { ...listing, interestCount: listing._count.interests };
    return this.formatListing(withCount, userId);
  }

  async createListing(userId: string, dto: CreateListingDto) {
    const data: Prisma.HousingListingCreateInput = {
      owner: { connect: { id: userId } },
      title: dto.title,
      description: dto.description,
      propertyType: dto.propertyType,
      price: dto.price,
      currency: dto.currency ?? 'USD',
      deposit: dto.deposit,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      sqft: dto.sqft,
      floor: dto.floor,
      address: dto.address,
      neighborhood: dto.neighborhood,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      latitude: dto.latitude,
      longitude: dto.longitude,
      availableDate: dto.availableDate ? new Date(dto.availableDate) : undefined,
      leaseTerm: dto.leaseTerm,
      isFurnished: dto.isFurnished ?? false,
      petPolicy: dto.petPolicy,
      parking: dto.parking,
      laundry: dto.laundry,
      heating: dto.heating,
      cooling: dto.cooling,
      utilities: dto.utilities,
      yearBuilt: dto.yearBuilt,
      amenities: dto.amenities ?? [],
      transitInfo: dto.transitInfo,
      walkScore: dto.walkScore,
    };
    const created = await this.prisma.housingListing.create({
      data,
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
    });
    const withCount = { ...created, interestCount: 0 };
    return this.formatListing(withCount, userId);
  }

  async updateListing(userId: string, listingId: string, dto: UpdateListingDto) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    if (listing.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own listings',
      });
    }
    const updateData: Prisma.HousingListingUpdateInput = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.propertyType !== undefined) updateData.propertyType = dto.propertyType;
    if (dto.price !== undefined) updateData.price = dto.price;
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.deposit !== undefined) updateData.deposit = dto.deposit;
    if (dto.bedrooms !== undefined) updateData.bedrooms = dto.bedrooms;
    if (dto.bathrooms !== undefined) updateData.bathrooms = dto.bathrooms;
    if (dto.sqft !== undefined) updateData.sqft = dto.sqft;
    if (dto.floor !== undefined) updateData.floor = dto.floor;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.neighborhood !== undefined) updateData.neighborhood = dto.neighborhood;
    if (dto.city !== undefined) updateData.city = dto.city;
    if (dto.state !== undefined) updateData.state = dto.state;
    if (dto.country !== undefined) updateData.country = dto.country;
    if (dto.latitude !== undefined) updateData.latitude = dto.latitude;
    if (dto.longitude !== undefined) updateData.longitude = dto.longitude;
    if (dto.availableDate !== undefined)
      updateData.availableDate = dto.availableDate ? new Date(dto.availableDate) : null;
    if (dto.leaseTerm !== undefined) updateData.leaseTerm = dto.leaseTerm;
    if (dto.isFurnished !== undefined) updateData.isFurnished = dto.isFurnished;
    if (dto.petPolicy !== undefined) updateData.petPolicy = dto.petPolicy;
    if (dto.parking !== undefined) updateData.parking = dto.parking;
    if (dto.laundry !== undefined) updateData.laundry = dto.laundry;
    if (dto.heating !== undefined) updateData.heating = dto.heating;
    if (dto.cooling !== undefined) updateData.cooling = dto.cooling;
    if (dto.utilities !== undefined) updateData.utilities = dto.utilities;
    if (dto.yearBuilt !== undefined) updateData.yearBuilt = dto.yearBuilt;
    if (dto.amenities !== undefined) updateData.amenities = dto.amenities;
    if (dto.transitInfo !== undefined) updateData.transitInfo = dto.transitInfo;
    if (dto.walkScore !== undefined) updateData.walkScore = dto.walkScore;
    if (dto.status !== undefined) updateData.status = dto.status;

    await this.prisma.housingListing.update({
      where: { id: listingId },
      data: updateData,
    });
    return this.getListingById(userId, listingId);
  }

  async deleteListing(userId: string, listingId: string) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      include: { images: true },
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    if (listing.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only delete your own listings',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.housingSave.deleteMany({ where: { listingId } });
      await tx.housingInterest.deleteMany({ where: { listingId } });
      await tx.housingImage.deleteMany({ where: { listingId } });
      await tx.housingListing.delete({ where: { id: listingId } });
    });
    await Promise.all(
      listing.images.map(async (img) => {
        try {
          await this.storageService.deleteFile(img.imageUrl);
        } catch {
          // ignore object already deleted
        }
      }),
    );
    return { message: 'Listing deleted' };
  }

  async markInterest(userId: string, listingId: string) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      select: { id: true, ownerId: true, status: true },
    });
    if (!listing || listing.status !== 'AVAILABLE') {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    if (listing.ownerId === userId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Cannot mark interest on your own listing',
      });
    }
    const ownerBlockedUser = await this.prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId: listing.ownerId, blockedId: userId } },
    });
    if (ownerBlockedUser) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    try {
      await this.prisma.housingInterest.create({
        data: { listingId, userId },
      });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
    }
    return { interested: true };
  }

  async removeInterest(userId: string, listingId: string) {
    await this.prisma.housingInterest.deleteMany({
      where: { listingId, userId },
    });
    return { interested: false };
  }

  async uploadListingImages(
    userId: string,
    listingId: string,
    files: Express.Multer.File[],
  ) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      include: { images: true },
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    if (listing.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own listings',
      });
    }
    const existing = listing.images.length;
    if (existing + files.length > LISTING_IMAGE_MAX) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Maximum 6 images per listing. You have ${existing} already.`,
      });
    }
    const results: Array<{ id: string; url: string; order: number; caption: string | null }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > LISTING_IMAGE_MAX_SIZE) {
        throw new BadRequestException({
          code: 'FILE_TOO_LARGE',
          message: 'Image must be under 5MB',
        });
      }
      if (!LISTING_IMAGE_MIME.includes(file.mimetype)) {
        throw new BadRequestException({
          code: 'FILE_INVALID_TYPE',
          message: 'Image must be JPEG, PNG, or WebP',
        });
      }
      const extension = StorageService.extensionFromMime(file.mimetype);
      const imageUrl = await this.storageService.uploadPublicFile(
        file.buffer,
        file.mimetype,
        `listings/${listingId}`,
        randomUUID(),
        extension,
      );
      const img = await this.prisma.housingImage.create({
        data: {
          listingId,
          imageUrl,
          order: existing + i,
        },
      });
      results.push({
        id: img.id,
        url: this.buildFileUrl(imageUrl),
        order: img.order,
        caption: img.caption,
      });
    }
    return results;
  }

  async removeListingImage(
    userId: string,
    listingId: string,
    imageId: string,
  ) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      include: { images: true },
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    if (listing.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own listings',
      });
    }
    const img = listing.images.find((i) => i.id === imageId);
    if (!img) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Image not found',
      });
    }
    await this.prisma.housingImage.delete({ where: { id: imageId } });
    try {
      await this.storageService.deleteFile(img.imageUrl);
    } catch {
      // ignore
    }
    return { message: 'Image removed' };
  }

  async getMyListings(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.housingListing.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
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
      }),
      this.prisma.housingListing.count({ where: { ownerId: userId } }),
    ]);
    const data = items.map((listing) => {
      const withCount = { ...listing, interestCount: listing._count.interests };
      return this.formatListing(withCount, userId);
    });
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async toggleSave(userId: string, listingId: string) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      select: { id: true },
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.housingSave.findUnique({
        where: {
          userId_listingId: { userId, listingId },
        },
      });
      if (existing) {
        await tx.housingSave.delete({ where: { id: existing.id } });
        return { saved: false };
      }
      await tx.housingSave.create({
        data: { userId, listingId },
      });
      return { saved: true };
    });
  }

  async getSavedListings(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
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
    const data = rows.map((row) => {
      const listing = row.listing;
      const withCount = { ...listing, interestCount: listing._count.interests };
      return this.formatListing(withCount, userId, true);
    });
    return { data, meta: createPaginationMeta(page, limit, total) };
  }
}


