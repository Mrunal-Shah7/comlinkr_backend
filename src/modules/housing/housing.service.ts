import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger, // SPRINT-37: warn when best-effort Cloudinary cleanup fails
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { HousingQueryDto } from './dto/housing-query.dto';
import {
  PaginationDto,
  createPaginationMeta,
} from '../../common/dto/pagination.dto';

export const LISTING_IMAGE_MAX = 6; // SPRINT-37: share one maximum between controller interception and service capacity checks
const LISTING_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const LISTING_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class HousingService {
  private readonly logger = new Logger(HousingService.name); // SPRINT-37: retain storage cleanup failures without failing owner requests

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  private buildFileUrl(imageUrl: string): string {
    return imageUrl;
  }

  private formatImages(
    // SPRINT-37: centralize ordered housing image response formatting
    images: Array<{
      id: string;
      imageUrl: string;
      order: number;
      caption: string | null;
    }>, // SPRINT-37: accept persisted image rows
  ) {
    // SPRINT-37: complete ordered formatter signature
    return [...images] // SPRINT-37: avoid mutating Prisma result arrays
      .sort((a, b) => a.order - b.order) // SPRINT-37: guarantee ascending stored order at the response boundary
      .map((image) => ({
        // SPRINT-37: preserve the established image response shape
        id: image.id, // SPRINT-37: expose image identity
        url: this.buildFileUrl(image.imageUrl), // SPRINT-37: expose the public object URL
        order: image.order, // SPRINT-37: expose contiguous stored order
        caption: image.caption, // SPRINT-37: preserve optional caption
      })); // SPRINT-37: complete ordered image mapping
  } // SPRINT-37: complete shared image formatter

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
    const isInterested = currentUserId && (listing.interests?.length ?? 0) > 0;
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
      images: this.formatImages(listing.images ?? []), // SPRINT-37: guarantee ordered images for every housing formatter caller
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
      const listingWithCount = {
        ...listing,
        interestCount: listing._count.interests,
      };
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
      availableDate: dto.availableDate
        ? new Date(dto.availableDate)
        : undefined,
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

  async updateListing(
    userId: string,
    listingId: string,
    dto: UpdateListingDto,
  ) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      select: { id: true, ownerId: true, status: true }, // SPRINT-37: load only identity, persisted ownership, and current status before writes
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
    const hasChanges = Object.values(dto).some((value) => value !== undefined); // SPRINT-37: detect an empty partial update explicitly
    if (!hasChanges) {
      // SPRINT-37: reject silent no-op updates
      throw new BadRequestException({
        // SPRINT-37: use the established structured API error shape
        code: 'BAD_REQUEST', // SPRINT-37: identify invalid owner input
        message: 'No changes were supplied', // SPRINT-37: name the empty-update condition
      }); // SPRINT-37: complete empty-update error
    } // SPRINT-37: complete defined-field gate
    const updateData: Prisma.HousingListingUpdateInput = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.propertyType !== undefined)
      updateData.propertyType = dto.propertyType;
    if (dto.price !== undefined) updateData.price = dto.price;
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.deposit !== undefined) updateData.deposit = dto.deposit;
    if (dto.bedrooms !== undefined) updateData.bedrooms = dto.bedrooms;
    if (dto.bathrooms !== undefined) updateData.bathrooms = dto.bathrooms;
    if (dto.sqft !== undefined) updateData.sqft = dto.sqft;
    if (dto.floor !== undefined) updateData.floor = dto.floor;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.neighborhood !== undefined)
      updateData.neighborhood = dto.neighborhood;
    if (dto.city !== undefined) updateData.city = dto.city;
    if (dto.state !== undefined) updateData.state = dto.state;
    if (dto.country !== undefined) updateData.country = dto.country;
    if (dto.availableDate !== undefined)
      updateData.availableDate = dto.availableDate
        ? new Date(dto.availableDate)
        : null;
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
    const updated = await this.prisma.housingListing.findUnique({
      // SPRINT-37: reload without incrementing the listing view counter
      where: { id: listingId }, // SPRINT-37: load the edited listing
      include: {
        // SPRINT-37: match detail-response relations
        owner: {
          // SPRINT-37: include owner identity and badges
          include: { userBadges: { select: { badgeType: true } } }, // SPRINT-37: preserve owner badge response shape
        }, // SPRINT-37: complete owner include
        images: { orderBy: { order: 'asc' } }, // SPRINT-37: return images in persisted order
        _count: { select: { interests: true } }, // SPRINT-37: preserve interest aggregate
        interests: {
          // SPRINT-37: derive current user's interest state
          where: { userId }, // SPRINT-37: scope interest relation to acting user
          select: { id: true }, // SPRINT-37: select only existence marker
        }, // SPRINT-37: complete interest include
        saves: {
          // SPRINT-37: derive current user's save state
          where: { userId }, // SPRINT-37: scope saves to acting user
          select: { id: true }, // SPRINT-37: select only existence marker
        }, // SPRINT-37: complete save include
      }, // SPRINT-37: complete detail-equivalent relations
    }); // SPRINT-37: complete post-update reload
    if (!updated) throw new NotFoundException('Listing not found'); // SPRINT-37: guard against an unexpected concurrent deletion
    const withCount = { ...updated, interestCount: updated._count.interests }; // SPRINT-37: preserve the standard formatter aggregate
    return this.formatListing(withCount, userId); // SPRINT-37: return the established listing response shape
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
      where: {
        blockerId_blockedId: { blockerId: listing.ownerId, blockedId: userId },
      },
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

  async reportListing(reporterId: string, listingId: string, reason: string) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      select: { id: true, ownerId: true },
    });

    if (!listing) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing not found',
      });
    }

    if (listing.ownerId === reporterId) {
      throw new BadRequestException('You cannot report your own listing.');
    }

    await this.prisma.listingReport.create({
      data: {
        reporterId,
        targetType: 'HOUSING',
        targetId: listingId,
        reason,
      },
    });

    return { message: 'Report submitted. Our team will review it shortly.' };
  }

  async uploadListingImages(
    userId: string,
    listingId: string,
    files: Express.Multer.File[],
  ) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      select: {
        // SPRINT-37: load only persisted ownership and current image ordering before writes
        id: true, // SPRINT-37: retain listing identity
        ownerId: true, // SPRINT-37: compare ownership to the session user
        images: {
          // SPRINT-37: calculate capacity and append position
          orderBy: { order: 'asc' }, // SPRINT-37: preserve existing relative order
          select: { id: true, imageUrl: true, order: true, caption: true }, // SPRINT-37: select fields needed for ordering
        }, // SPRINT-37: complete current image selection
      }, // SPRINT-37: complete owner/image preflight selection
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
    if (files.length === 0) {
      // SPRINT-37: protect service callers that bypass the controller file check
      throw new BadRequestException({
        // SPRINT-37: reject an empty image addition
        code: 'BAD_REQUEST', // SPRINT-37: identify invalid input
        message: 'No files uploaded', // SPRINT-37: state the missing-file condition
      }); // SPRINT-37: complete empty-upload error
    } // SPRINT-37: complete empty-file gate
    const existing = listing.images.length;
    if (existing + files.length > LISTING_IMAGE_MAX) {
      const remainingCapacity = Math.max(0, LISTING_IMAGE_MAX - existing); // SPRINT-37: report exactly how many images can still be added
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Maximum ${LISTING_IMAGE_MAX} images per listing; ${remainingCapacity} more may be added.`, // SPRINT-37: state both limit and remaining capacity
      });
    }
    for (const file of files) {
      // SPRINT-37: validate the complete batch before uploading any object
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
    } // SPRINT-37: complete all-or-nothing batch validation
    const highestOrder = listing.images.reduce(
      // SPRINT-37: append after the actual highest stored order rather than image count
      (highest, image) => Math.max(highest, image.order), // SPRINT-37: preserve existing order values even if gaps predate this sprint
      -1, // SPRINT-37: make the first image start at zero
    ); // SPRINT-37: complete append-position calculation
    const uploadedUrls: string[] = []; // SPRINT-37: track objects for rollback if a later upload or database write fails
    try {
      // SPRINT-37: guarantee best-effort cleanup for partial external uploads
      for (const file of files) {
        // SPRINT-37: upload each already-validated image
        const extension = StorageService.extensionFromMime(file.mimetype); // SPRINT-37: preserve the existing file extension mapping
        const imageUrl = await this.storageService.uploadPublicFile(
          // SPRINT-37: reuse the established Cloudinary public upload path
          file.buffer, // SPRINT-37: upload validated bytes
          file.mimetype, // SPRINT-37: preserve validated MIME
          `listings/${listingId}`, // SPRINT-37: retain the creation-time listing image prefix
          randomUUID(), // SPRINT-37: keep object names unguessable
          extension, // SPRINT-37: preserve playable/renderable extension
        ); // SPRINT-37: complete one object upload
        uploadedUrls.push(imageUrl); // SPRINT-37: retain URL for atomic database creation or rollback
      } // SPRINT-37: complete external object uploads
      await this.prisma.$transaction(
        // SPRINT-37: create every image row atomically after all uploads succeed
        uploadedUrls.map(
          (
            imageUrl,
            index, // SPRINT-37: map each uploaded object to its appended order
          ) =>
            this.prisma.housingImage.create({
              // SPRINT-37: create one relation row
              data: {
                // SPRINT-37: define the appended image relation
                listingId, // SPRINT-37: attach to the owner-verified listing
                imageUrl, // SPRINT-37: persist the Cloudinary URL
                order: highestOrder + index + 1, // SPRINT-37: continue monotonically from the current highest order
              }, // SPRINT-37: complete image row data
            }), // SPRINT-37: complete image row operation
        ), // SPRINT-37: complete atomic create operation list
      ); // SPRINT-37: complete image-row transaction
    } catch (error) {
      // SPRINT-37: roll back external objects after any later failure
      await Promise.all(
        // SPRINT-37: attempt cleanup of every successfully uploaded object
        uploadedUrls.map(async (imageUrl) => {
          // SPRINT-37: clean one uploaded URL
          try {
            // SPRINT-37: keep cleanup failures from masking the original error
            await this.storageService.deleteFile(imageUrl); // SPRINT-37: remove the orphaned Cloudinary object
          } catch (cleanupError) {
            // SPRINT-37: retain evidence of an orphan cleanup failure
            this.logger.warn(
              // SPRINT-37: make repeated Cloudinary permission failures visible
              `Failed to roll back listing image ${imageUrl}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, // SPRINT-37: include safe object URL and reason
            ); // SPRINT-37: complete rollback warning
          } // SPRINT-37: complete one cleanup attempt
        }), // SPRINT-37: complete cleanup mapping
      ); // SPRINT-37: wait for all rollback attempts
      throw error; // SPRINT-37: preserve the original upload/database failure
    } // SPRINT-37: complete rollback boundary
    const images = await this.prisma.housingImage.findMany({
      // SPRINT-37: return the listing's complete ordered image collection
      where: { listingId }, // SPRINT-37: scope to the edited listing
      orderBy: { order: 'asc' }, // SPRINT-37: guarantee persisted order
    }); // SPRINT-37: complete ordered image reload
    return this.formatImages(images); // SPRINT-37: return the standard ordered image shape
  }

  async removeListingImage(userId: string, listingId: string, imageId: string) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      select: { id: true, ownerId: true }, // SPRINT-37: load persisted ownership before any image write or storage operation
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
    const img = await this.prisma.housingImage.findFirst({
      // SPRINT-37: ensure the image belongs to the listing named in the route
      where: { id: imageId, listingId }, // SPRINT-37: reject cross-listing image identifiers
    }); // SPRINT-37: complete image/listing membership lookup
    if (!img) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Image not found',
      });
    }
    await this.prisma.housingImage.delete({ where: { id: imageId } });
    try {
      // SPRINT-37: perform best-effort object cleanup after the database row is gone
      await this.storageService.deleteFile(img.imageUrl); // SPRINT-37: remove the underlying Cloudinary object through StorageService
    } catch (error) {
      // SPRINT-37: satisfy user intent even when external deletion fails
      this.logger.warn(
        // SPRINT-37: retain actionable cleanup evidence
        `Failed to delete listing image object ${img.imageUrl}: ${error instanceof Error ? error.message : String(error)}`, // SPRINT-37: identify object and safe failure reason
      ); // SPRINT-37: complete storage warning
    } // SPRINT-37: complete best-effort object deletion
    const remaining = await this.prisma.housingImage.findMany({
      // SPRINT-37: preserve relative sequence before contiguous renumbering
      where: { listingId }, // SPRINT-37: scope remaining rows to the owner-verified listing
      orderBy: { order: 'asc' }, // SPRINT-37: retain prior relative order
    }); // SPRINT-37: complete remaining image lookup
    if (remaining.length > 0) {
      // SPRINT-37: avoid an empty transaction when the final image was removed
      await this.prisma.$transaction(
        // SPRINT-37: renumber all remaining rows atomically
        remaining.map(
          (
            image,
            index, // SPRINT-37: assign contiguous order from zero
          ) =>
            this.prisma.housingImage.update({
              // SPRINT-37: update one remaining image order
              where: { id: image.id }, // SPRINT-37: target the persisted image
              data: { order: index }, // SPRINT-37: remove gaps while preserving relative sequence
            }), // SPRINT-37: complete one renumber operation
        ), // SPRINT-37: complete renumber operation list
      ); // SPRINT-37: complete contiguous renumber transaction
    } // SPRINT-37: complete non-empty renumber gate
    const ordered = await this.prisma.housingImage.findMany({
      // SPRINT-37: return persisted post-removal state
      where: { listingId }, // SPRINT-37: scope response to the edited listing
      orderBy: { order: 'asc' }, // SPRINT-37: guarantee ascending response order
    }); // SPRINT-37: complete post-removal reload
    return this.formatImages(ordered); // SPRINT-37: return the standard remaining image array
  }

  async reorderListingImages(
    // SPRINT-37: apply an idempotent complete desired image ordering
    userId: string, // SPRINT-37: receive only the session-derived actor identifier
    listingId: string, // SPRINT-37: identify the listing to edit
    imageIds: string[], // SPRINT-37: receive every image identifier in desired order
  ) {
    // SPRINT-37: complete reorder method signature
    const listing = await this.prisma.housingListing.findUnique({
      // SPRINT-37: load the listing before any image write
      where: { id: listingId }, // SPRINT-37: identify the requested listing
      select: { id: true, ownerId: true }, // SPRINT-37: select only identity and persisted ownership
    }); // SPRINT-37: complete ownership lookup
    if (!listing) {
      // SPRINT-37: distinguish a missing listing before authorization
      throw new NotFoundException({
        // SPRINT-37: return the established structured error
        code: 'RESOURCE_NOT_FOUND', // SPRINT-37: identify missing resource
        message: 'Listing not found', // SPRINT-37: name the missing listing
      }); // SPRINT-37: complete missing-listing error
    } // SPRINT-37: complete existence gate
    if (listing.ownerId !== userId) {
      // SPRINT-37: compare persisted owner only to the session user
      throw new ForbiddenException({
        // SPRINT-37: reject non-owner reorder before writes
        code: 'FORBIDDEN', // SPRINT-37: identify authorization failure
        message: 'You can only edit your own listings', // SPRINT-37: state the owner restriction
      }); // SPRINT-37: complete ownership error
    } // SPRINT-37: complete ownership gate
    const images = await this.prisma.housingImage.findMany({
      // SPRINT-37: load the complete current image set
      where: { listingId }, // SPRINT-37: scope to the owner-verified listing
      select: { id: true }, // SPRINT-37: compare only identifiers
    }); // SPRINT-37: complete current image lookup
    const suppliedSet = new Set(imageIds); // SPRINT-37: detect duplicates and compare exact membership
    const currentSet = new Set(images.map((image) => image.id)); // SPRINT-37: represent the authoritative image identifier set
    const isExactSet = // SPRINT-37: require no missing, extra, or duplicated identifiers
      imageIds.length === images.length && // SPRINT-37: require equal list lengths
      suppliedSet.size === imageIds.length && // SPRINT-37: reject duplicate identifiers
      imageIds.every((imageId) => currentSet.has(imageId)); // SPRINT-37: reject missing or foreign identifiers
    if (!isExactSet) {
      // SPRINT-37: reject every partial or malformed ordering
      throw new BadRequestException({
        // SPRINT-37: return the established structured API error
        code: 'BAD_REQUEST', // SPRINT-37: identify invalid ordering input
        message: 'Image ordering must contain every listing image exactly once', // SPRINT-37: state the complete-list contract
      }); // SPRINT-37: complete invalid-order error
    } // SPRINT-37: complete exact-set validation
    if (imageIds.length > 0) {
      // SPRINT-37: permit an exact empty order for a zero-image listing
      await this.prisma.$transaction(
        // SPRINT-37: persist the complete new ordering atomically
        imageIds.map(
          (
            imageId,
            index, // SPRINT-37: map desired position to stored order
          ) =>
            this.prisma.housingImage.update({
              // SPRINT-37: update one image order
              where: { id: imageId }, // SPRINT-37: target an identifier already validated as belonging to the listing
              data: { order: index }, // SPRINT-37: write the desired zero-based position
            }), // SPRINT-37: complete one reorder operation
        ), // SPRINT-37: complete atomic reorder operation list
      ); // SPRINT-37: complete reorder transaction
    } // SPRINT-37: complete non-empty transaction gate
    const reordered = await this.prisma.housingImage.findMany({
      // SPRINT-37: return the authoritative new order
      where: { listingId }, // SPRINT-37: scope response to the edited listing
      orderBy: { order: 'asc' }, // SPRINT-37: return desired order
    }); // SPRINT-37: complete reordered image reload
    return this.formatImages(reordered); // SPRINT-37: return the standard ordered image array
  } // SPRINT-37: complete reorder service method

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
