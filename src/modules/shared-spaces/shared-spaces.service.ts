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
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSharedSpaceDto } from './dto/create-shared-space.dto';
import { UpdateSharedSpaceDto } from './dto/update-shared-space.dto';
import { SharedSpacesQueryDto } from './dto/shared-spaces-query.dto';
import { createPaginationMeta } from '../../common/dto/pagination.dto';

const SPACE_IMAGE_MAX = 6;
const SPACE_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const SPACE_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class SharedSpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async buildFileUrl(imageUrl: string | null | undefined): Promise<string> {
    if (imageUrl == null || imageUrl === '') return '';
    return this.storageService.getReadUrlForClient(imageUrl);
  }

  async formatSharedSpace(
    space: Prisma.SharedSpaceGetPayload<{
      include: {
        owner: {
          select: {
            id: true;
            username: true;
            fullName: true;
            avatarUrl: true;
            userBadges: { select: { badgeType: true } };
          };
        };
        images: true;
        _count: { select: { applications: true } };
      };
    }>,
    userId: string,
    savedIds?: Set<string>,
  ) {
    const sortedImages = [...space.images].sort((a, b) => a.order - b.order);
    const imageRows = await Promise.all(
      sortedImages.map(async (img) => ({
        id: img.id,
        url: await this.buildFileUrl(img.imageUrl),
        order: img.order,
      })),
    );
    let isSaved: boolean;
    if (savedIds) {
      isSaved = savedIds.has(space.id);
    } else {
      const s = await this.prisma.sharedSpaceSave.findUnique({
        where: { userId_sharedSpaceId: { userId, sharedSpaceId: space.id } },
        select: { id: true },
      });
      isSaved = !!s;
    }
    const owner = space.owner;
    const avatarUrl = owner.avatarUrl ? await this.buildFileUrl(owner.avatarUrl) : null;
    return {
      id: space.id,
      title: space.title,
      description: space.description,
      address: space.address,
      city: space.city,
      state: space.state,
      country: space.country,
      latitude: space.latitude,
      longitude: space.longitude,
      price: Number(space.price),
      currency: space.currency,
      deposit: space.deposit != null ? Number(space.deposit) : undefined,
      rooms: space.rooms,
      bathrooms: space.bathrooms,
      totalOccupants: space.totalOccupants,
      currentOccupants: space.currentOccupants,
      availableSpots: space.availableSpots,
      petPolicy: space.petPolicy,
      smoking: space.smoking,
      amenities: space.amenities,
      houseRules: space.houseRules,
      isVerified: space.isVerified,
      isActive: space.isActive,
      createdAt: space.createdAt.toISOString(),
      updatedAt: space.updatedAt.toISOString(),
      owner: {
        id: owner.id,
        username: owner.username,
        name: owner.fullName,
        avatarUrl,
        badges: (owner.userBadges ?? []).map((b) => ({ badgeType: b.badgeType })),
      },
      host: {
        id: owner.id,
        name: owner.fullName,
        username: owner.username,
        avatar: avatarUrl ?? undefined,
        verified: space.isVerified,
      },
      images: imageRows.map((r) => r.url).filter((u) => u.length > 0),
      imageRefs: imageRows,
      applicationCount: space._count?.applications ?? 0,
      isSaved,
      savedByMe: isSaved,
      isOwner: space.ownerId === userId,
    };
  }

  async getSharedSpaces(userId: string, query: SharedSpacesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SharedSpaceWhereInput = { isActive: true };
    if (query.city?.trim()) {
      where.city = { contains: query.city.trim(), mode: 'insensitive' };
    }
    if (query.maxPrice != null) {
      where.price = { lte: query.maxPrice };
    }
    if (query.petFriendly === 'true') {
      where.petPolicy = { not: null };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.sharedSpace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
              userBadges: { select: { badgeType: true } },
            },
          },
          images: true,
          _count: { select: { applications: true } },
        },
      }),
      this.prisma.sharedSpace.count({ where }),
    ]);
    const ids = items.map((i) => i.id);
    const saves =
      ids.length === 0
        ? []
        : await this.prisma.sharedSpaceSave.findMany({
            where: { userId, sharedSpaceId: { in: ids } },
            select: { sharedSpaceId: true },
          });
    const savedSet = new Set(saves.map((s) => s.sharedSpaceId));
    const data = await Promise.all(items.map((s) => this.formatSharedSpace(s, userId, savedSet)));
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getMySharedSpaces(userId: string) {
    const items = await this.prisma.sharedSpace.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            userBadges: { select: { badgeType: true } },
          },
        },
        images: true,
        _count: { select: { applications: true } },
      },
    });
    const savedSet = new Set<string>();
    return Promise.all(items.map((s) => this.formatSharedSpace(s, userId, savedSet)));
  }

  async getSharedSpaceById(userId: string, id: string) {
    const space = await this.prisma.sharedSpace.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            userBadges: { select: { badgeType: true } },
          },
        },
        images: true,
        _count: { select: { applications: true } },
      },
    });
    if (!space) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Shared space not found' });
    }
    return this.formatSharedSpace(space, userId);
  }

  async createSharedSpace(userId: string, dto: CreateSharedSpaceDto) {
    const created = await this.prisma.sharedSpace.create({
      data: {
        ownerId: userId,
        title: dto.title,
        description: dto.description,
        address: dto.address,
        city: dto.city,
        state: dto.state ?? null,
        country: dto.country,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        price: dto.price,
        currency: dto.currency?.trim() || 'USD',
        deposit: dto.deposit != null ? dto.deposit : null,
        rooms: dto.rooms,
        bathrooms: dto.bathrooms,
        totalOccupants: dto.totalOccupants,
        currentOccupants: 0,
        availableSpots: dto.availableSpots,
        petPolicy: dto.petPolicy ?? null,
        smoking: dto.smoking ?? false,
        amenities: dto.amenities ?? [],
        houseRules: dto.houseRules ?? [],
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            userBadges: { select: { badgeType: true } },
          },
        },
        images: true,
        _count: { select: { applications: true } },
      },
    });
    return this.formatSharedSpace(created, userId);
  }

  async updateSharedSpace(userId: string, id: string, dto: UpdateSharedSpaceDto) {
    const space = await this.prisma.sharedSpace.findUnique({ where: { id } });
    if (!space) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Shared space not found' });
    }
    if (space.ownerId !== userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the owner can update this space' });
    }
    const data: Prisma.SharedSpaceUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.deposit !== undefined) data.deposit = dto.deposit;
    if (dto.rooms !== undefined) data.rooms = dto.rooms;
    if (dto.bathrooms !== undefined) data.bathrooms = dto.bathrooms;
    if (dto.totalOccupants !== undefined) data.totalOccupants = dto.totalOccupants;
    if (dto.availableSpots !== undefined) data.availableSpots = dto.availableSpots;
    if (dto.petPolicy !== undefined) data.petPolicy = dto.petPolicy;
    if (dto.smoking !== undefined) data.smoking = dto.smoking;
    if (dto.amenities !== undefined) data.amenities = dto.amenities;
    if (dto.houseRules !== undefined) data.houseRules = dto.houseRules;

    const updated = await this.prisma.sharedSpace.update({
      where: { id },
      data,
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            userBadges: { select: { badgeType: true } },
          },
        },
        images: true,
        _count: { select: { applications: true } },
      },
    });
    return this.formatSharedSpace(updated, userId);
  }

  async deleteSharedSpace(userId: string, id: string) {
    const space = await this.prisma.sharedSpace.findUnique({
      where: { id },
      include: { images: true },
    });
    if (!space) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Shared space not found' });
    }
    if (space.ownerId !== userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the owner can delete this space' });
    }
    for (const img of space.images) {
      try {
        await this.storageService.deleteFile(img.imageUrl);
      } catch {
        /* ignore */
      }
    }
    await this.prisma.sharedSpace.delete({ where: { id } });
    return { ok: true };
  }

  async uploadImages(userId: string, id: string, files: Express.Multer.File[]) {
    const space = await this.prisma.sharedSpace.findUnique({
      where: { id },
      include: { images: true },
    });
    if (!space) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Shared space not found' });
    }
    if (space.ownerId !== userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only add images to your own spaces' });
    }
    const existing = space.images.length;
    if (existing + files.length > SPACE_IMAGE_MAX) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Maximum ${SPACE_IMAGE_MAX} images. You have ${existing} already.`,
      });
    }
    const results: Array<{ id: string; url: string; order: number }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > SPACE_IMAGE_MAX_SIZE) {
        throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'Image must be under 5MB' });
      }
      if (!SPACE_IMAGE_MIME.includes(file.mimetype)) {
        throw new BadRequestException({
          code: 'FILE_INVALID_TYPE',
          message: 'Image must be JPEG, PNG, or WebP',
        });
      }
      const extension = StorageService.extensionFromMime(file.mimetype);
      const imageUrl = await this.storageService.uploadPublicFile(
        file.buffer,
        file.mimetype,
        `shared-spaces/${id}`,
        randomUUID(),
        extension,
      );
      const img = await this.prisma.sharedSpaceImage.create({
        data: { sharedSpaceId: id, imageUrl, order: existing + i },
      });
      results.push({
        id: img.id,
        url: await this.buildFileUrl(imageUrl),
        order: img.order,
      });
    }
    return results;
  }

  async deleteImage(userId: string, spaceId: string, imageId: string) {
    const space = await this.prisma.sharedSpace.findUnique({ where: { id: spaceId } });
    if (!space || space.ownerId !== userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the owner can remove images' });
    }
    const img = await this.prisma.sharedSpaceImage.findFirst({
      where: { id: imageId, sharedSpaceId: spaceId },
    });
    if (!img) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Image not found' });
    }
    try {
      await this.storageService.deleteFile(img.imageUrl);
    } catch {
      /* ignore */
    }
    await this.prisma.sharedSpaceImage.delete({ where: { id: imageId } });
    return { ok: true };
  }

  async applyToSpace(userId: string, spaceId: string, message?: string) {
    const space = await this.prisma.sharedSpace.findUnique({
      where: { id: spaceId },
      include: { owner: { select: { id: true, username: true } } },
    });
    if (!space) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Shared space not found' });
    }
    if (space.ownerId === userId) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'You cannot apply to your own space' });
    }
    const existing = await this.prisma.sharedSpaceApplication.findUnique({
      where: { sharedSpaceId_userId: { sharedSpaceId: spaceId, userId } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'You have already applied to this space',
      });
    }
    const app = await this.prisma.sharedSpaceApplication.create({
      data: {
        sharedSpaceId: spaceId,
        userId,
        message: message?.trim() || null,
      },
    });
    const applicant = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const uname = applicant?.username ?? 'Someone';
    await this.notificationsService.createNotification({
      userId: space.ownerId,
      type: 'MESSAGE',
      title: 'New application',
      body: `${uname} has applied to join your shared space.`,
      referenceType: 'SHARED_SPACE',
      referenceId: spaceId,
      actorId: userId,
    });
    return { applied: true, applicationId: app.id };
  }

  async toggleSave(userId: string, spaceId: string) {
    const space = await this.prisma.sharedSpace.findUnique({ where: { id: spaceId } });
    if (!space) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Shared space not found' });
    }
    const row = await this.prisma.sharedSpaceSave.findUnique({
      where: { userId_sharedSpaceId: { userId, sharedSpaceId: spaceId } },
    });
    if (row) {
      await this.prisma.sharedSpaceSave.delete({ where: { id: row.id } });
      return { saved: false };
    }
    await this.prisma.sharedSpaceSave.create({ data: { userId, sharedSpaceId: spaceId } });
    return { saved: true };
  }
}
