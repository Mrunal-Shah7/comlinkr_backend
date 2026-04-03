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
import { createPaginationMeta } from '../../common/dto/pagination.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsQueryDto } from './dto/events-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { TicketType } from '@prisma/client';

const EVENT_IMAGE_MAX = 6;
const EVENT_IMAGE_MAX_SIZE = 5 * 1024 * 1024;
const EVENT_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
  ) {}

  /** Readable URL for clients (presigned when bucket objects are private). */
  private async buildFileUrl(imageUrl: string | null | undefined): Promise<string> {
    if (imageUrl == null || imageUrl === '') return '';
    return this.storageService.getReadUrlForClient(imageUrl);
  }

  private async getUserCity(userId: string): Promise<string | null> {
    const loc = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    return loc?.city ?? null;
  }

  private async formatEvent(event: any, currentUserId?: string) {
    const attendeeCount = event.attendeeCount ?? event._count?.attendees ?? 0;
    const capacity = event.capacity;
    const isFull = capacity != null && attendeeCount >= capacity;
    const spotsLeft =
      capacity != null ? Math.max(0, capacity - attendeeCount) : null;
    const isAttending =
      currentUserId && (event.attendees?.length ?? 0) > 0;
    const savedByMe =
      currentUserId && (event.saves?.length ?? 0) > 0;
    const imageRows = event.eventImages ?? [];
    const sortedImages = [...imageRows].sort(
      (a: { order: number }, b: { order: number }) => a.order - b.order,
    );
    const images = (
      await Promise.all(
        sortedImages.map((row: { imageUrl: string | null }) =>
          this.buildFileUrl(row.imageUrl),
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
          ? await this.buildFileUrl(event.author.avatarUrl)
          : null,
      },
      isAttending: !!isAttending,
      /** Mobile alias for RSVP state */
      registeredByMe: !!isAttending,
      savedByMe,
      isFull,
      isOwner: currentUserId ? event.authorId === currentUserId : false,
      spotsLeft,
    };
  }

  async getEvents(userId: string, query: EventsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    let city: string | null = query.city ?? null;
    if (!city) city = await this.getUserCity(userId);

    const where: Prisma.EventWhereInput = {};
    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }
    if (query.category) where.category = query.category;
    if (query.format) where.format = query.format;
    let dateCondition: Prisma.DateTimeFilter | undefined;
    if (query.date) {
      const d = new Date(query.date);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      dateCondition = { gte: start, lt: end };
    }
    if (query.upcoming !== 'false') {
      const now = new Date();
      if (dateCondition && 'gte' in dateCondition) {
        const start = dateCondition.gte as Date;
        dateCondition = {
          gte: start > now ? start : now,
          ...('lt' in dateCondition && { lt: dateCondition.lt }),
        };
      } else {
        dateCondition = { gte: now };
      }
    }
    if (dateCondition) where.date = dateCondition;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        orderBy: { date: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
          attendees: {
            where: { userId },
            select: { id: true },
          },
          saves: {
            where: { userId },
            select: { id: true },
          },
          eventImages: { orderBy: { order: 'asc' } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    const data = await Promise.all(
      items.map((e) => this.formatEvent(e, userId)),
    );
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async getEventById(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        attendees: {
          where: { userId },
          select: { id: true },
        },
        saves: {
          where: { userId },
          select: { id: true },
        },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    return await this.formatEvent(event, userId);
  }

  async createEvent(userId: string, dto: CreateEventDto) {
    if (dto.ticketType === TicketType.PAID) {
      if (
        dto.ticketPrice == null ||
        dto.ticketPrice === undefined ||
        dto.ticketPrice <= 0
      ) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'Ticket price is required for paid events.',
        });
      }
    }
    const eventDate = new Date(dto.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    eventDate.setHours(0, 0, 0, 0);
    if (eventDate.getTime() < today.getTime()) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Event date must be in the future.',
      });
    }
    let city = dto.city;
    if (!city) {
      city = (await this.getUserCity(userId)) ?? '';
    }
    const created = await this.prisma.event.create({
      data: {
        authorId: userId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        format: dto.format,
        date: eventDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        venue: dto.venue,
        city,
        ticketType: dto.ticketType,
        ticketPrice: dto.ticketPrice,
        capacity: dto.capacity,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        attendees: {
          where: { userId },
          select: { id: true },
        },
        saves: {
          where: { userId },
          select: { id: true },
        },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    this.notifyEventNearby(created.id, created.title, created.city, userId).catch(() => {});
    return await this.formatEvent(created, userId);
  }

  async uploadEventImages(
    userId: string,
    eventId: string,
    files: Express.Multer.File[],
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { eventImages: true },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    if (event.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only add images to your own events',
      });
    }
    const existing = event.eventImages.length;
    if (existing + files.length > EVENT_IMAGE_MAX) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Maximum ${EVENT_IMAGE_MAX} images per event. You have ${existing} already.`,
      });
    }
    const results: Array<{ id: string; url: string; order: number }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > EVENT_IMAGE_MAX_SIZE) {
        throw new BadRequestException({
          code: 'FILE_TOO_LARGE',
          message: 'Image must be under 5MB',
        });
      }
      if (!EVENT_IMAGE_MIME.includes(file.mimetype)) {
        throw new BadRequestException({
          code: 'FILE_INVALID_TYPE',
          message: 'Image must be JPEG, PNG, or WebP',
        });
      }
      const extension = StorageService.extensionFromMime(file.mimetype);
      const imageUrl = await this.storageService.uploadPublicFile(
        file.buffer,
        file.mimetype,
        `events/${eventId}`,
        randomUUID(),
        extension,
      );
      const img = await this.prisma.eventImage.create({
        data: {
          eventId,
          imageUrl,
          order: existing + i,
        },
      });
      results.push({
        id: img.id,
        url: await this.buildFileUrl(imageUrl),
        order: img.order,
      });
    }
    return results;
  }

  private async notifyEventNearby(eventId: string, eventTitle: string, city: string, excludeUserId: string) {
    const usersInCity = await this.prisma.userLocation.findMany({
      where: { city: { equals: city, mode: 'insensitive' }, userId: { not: excludeUserId } },
      select: { userId: true },
    });
    await Promise.all(
      usersInCity.map((loc) =>
        this.notificationsService.createNotification({
          userId: loc.userId,
          type: 'EVENT_NEARBY',
          title: 'New event in your area',
          body: `"${eventTitle}" is happening in ${city}`,
          referenceType: 'EVENT',
          referenceId: eventId,
        }),
      ),
    );
  }

  async attendEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        attendees: { where: { userId }, select: { id: true } },
        saves: { where: { userId }, select: { id: true } },
      },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    if (event.authorId === userId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'You cannot RSVP to your own event.',
      });
    }
    if (event.attendees.length > 0) {
      return {
        attending: true,
        attendeeCount: event.attendeeCount,
      };
    }
    const capacity = event.capacity;
    if (capacity != null && event.attendeeCount >= capacity) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'This event is full.',
      });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.eventAttendee.create({
        data: { eventId, userId },
      });
      const updated = await tx.event.update({
        where: { id: eventId },
        data: { attendeeCount: { increment: 1 } },
      });
      return updated.attendeeCount;
    });
    return { attending: true, attendeeCount: result };
  }

  async cancelAttendance(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    const attendee = await this.prisma.eventAttendee.findUnique({
      where: {
        eventId_userId: { eventId, userId },
      },
    });
    if (!attendee) {
      return { attending: false, attendeeCount: event.attendeeCount };
    }
    const newCount = await this.prisma.$transaction(async (tx) => {
      await tx.eventAttendee.delete({
        where: { id: attendee.id },
      });
      const next = Math.max(0, event.attendeeCount - 1);
      await tx.event.update({
        where: { id: eventId },
        data: { attendeeCount: next },
      });
      return next;
    });
    return { attending: false, attendeeCount: newCount };
  }

  /** Mobile: same as attend; response uses { registered, attendees }. */
  async registerForEvent(userId: string, eventId: string) {
    const r = await this.attendEvent(userId, eventId);
    return { registered: r.attending, attendees: r.attendeeCount };
  }

  async cancelRegistration(userId: string, eventId: string) {
    const r = await this.cancelAttendance(userId, eventId);
    return { registered: r.attending, attendees: r.attendeeCount };
  }

  private categoryEmoji(category: string): string {
    const m: Record<string, string> = {
      SOCIAL: '🎉',
      SPORTS: '⚽',
      MUSIC: '🎵',
      ARTS: '🎨',
      FOOD_DRINK: '🍽️',
      TECH: '💻',
      HEALTH: '🏥',
      COMMUNITY: '🏘️',
      EDUCATION: '📚',
    };
    return m[category] ?? '📅';
  }

  async getStoryEvents(userId: string, city?: string) {
    let cityFilter = city ?? null;
    if (!cityFilter) cityFilter = await this.getUserCity(userId);
    const where: Prisma.EventWhereInput = {
      date: { gte: new Date() },
      ...(cityFilter
        ? { city: { contains: cityFilter, mode: 'insensitive' } }
        : {}),
    };
    const items = await this.prisma.event.findMany({
      where,
      orderBy: { date: 'asc' },
      take: 24,
      include: {
        author: { select: { id: true } },
        attendees: { where: { userId }, select: { id: true } },
        saves: { where: { userId }, select: { id: true } },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    return Promise.all(
      items.map(async (e) => ({
        id: e.id,
        emoji: this.categoryEmoji(e.category),
        title: e.title,
        date: e.date.toISOString().slice(0, 10),
        time: e.startTime,
        location: e.venue,
        image:
          e.eventImages[0]?.imageUrl
            ? await this.buildFileUrl(e.eventImages[0].imageUrl)
            : (undefined as string | undefined),
        attendees: e.attendeeCount,
        price: e.ticketPrice != null ? Number(e.ticketPrice) : null,
        tags: [] as string[],
        registeredByMe: e.attendees.length > 0,
      })),
    );
  }

  async getMyEvents(userId: string) {
    const items = await this.prisma.event.findMany({
      where: { authorId: userId },
      orderBy: { date: 'desc' },
      take: 100,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        attendees: { where: { userId }, select: { id: true } },
        saves: { where: { userId }, select: { id: true } },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    return Promise.all(items.map((e) => this.formatEvent(e, userId)));
  }

  async getRegisteredEvents(userId: string) {
    const rows = await this.prisma.eventAttendee.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      take: 100,
      include: {
        event: {
          include: {
            author: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
            attendees: { where: { userId }, select: { id: true } },
            saves: { where: { userId }, select: { id: true } },
            eventImages: { orderBy: { order: 'asc' } },
          },
        },
      },
    });
    return Promise.all(rows.map((r) => this.formatEvent(r.event, userId)));
  }

  async getSavedEvents(userId: string, query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { saves: { some: { userId } } };
    const [items, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: { date: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
          attendees: { where: { userId }, select: { id: true } },
          saves: { where: { userId }, select: { id: true } },
          eventImages: { orderBy: { order: 'asc' } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);
    const data = await Promise.all(
      items.map((e) => this.formatEvent(e, userId)),
    );
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async toggleSaveEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    const existing = await this.prisma.eventSave.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });
    if (existing) {
      await this.prisma.eventSave.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    await this.prisma.eventSave.create({ data: { userId, eventId } });
    return { saved: true };
  }

  async reportEvent(userId: string, eventId: string, reason: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    await this.prisma.contentReport.create({
      data: {
        reporterId: userId,
        targetType: 'EVENT',
        targetId: eventId,
        reason,
      },
    });
    return { ok: true };
  }

  async updateEvent(userId: string, eventId: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    if (event.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the host can update this event.',
      });
    }
    const data: Prisma.EventUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.format !== undefined) data.format = dto.format;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    if (dto.venue !== undefined) data.venue = dto.venue;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.ticketType !== undefined) data.ticketType = dto.ticketType;
    if (dto.ticketPrice !== undefined) data.ticketPrice = dto.ticketPrice;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        attendees: { where: { userId }, select: { id: true } },
        saves: { where: { userId }, select: { id: true } },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    return await this.formatEvent(updated, userId);
  }

  async deleteEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    if (event.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the host can delete this event.',
      });
    }
    await this.prisma.$transaction([
      this.prisma.eventSave.deleteMany({ where: { eventId } }),
      this.prisma.eventAttendee.deleteMany({ where: { eventId } }),
      this.prisma.event.delete({ where: { id: eventId } }),
    ]);
    return { ok: true };
  }

  async getEventAttendees(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        attendees: {
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
    if (!event) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      });
    }
    if (event.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the host can view attendees.',
      });
    }
    return Promise.all(
      event.attendees.map(async (a) => ({
        id: a.user.id,
        name: a.user.fullName,
        username: a.user.username,
        avatar: a.user.avatarUrl
          ? await this.buildFileUrl(a.user.avatarUrl)
          : undefined,
        registeredAt: a.joinedAt.toISOString(),
      })),
    );
  }

  async getMyTicket(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        attendees: { where: { userId }, select: { id: true, joinedAt: true } },
        author: { select: { fullName: true } },
      },
    });
    if (!event || event.attendees.length === 0) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'No ticket for this event',
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true },
    });
    return {
      id: `ticket_${eventId}_${userId}`,
      eventId: event.id,
      eventTitle: event.title,
      eventEmoji: this.categoryEmoji(event.category),
      date: event.date.toISOString().slice(0, 10),
      time: event.startTime,
      location: event.venue,
      attendeeName: user?.fullName ?? 'Guest',
      attendeeEmail: user?.email ?? '',
      quantity: 1,
      totalPrice: Number(event.ticketPrice ?? 0),
      qrCode: '',
      issuedAt: event.attendees[0].joinedAt.toISOString(),
    };
  }
}


