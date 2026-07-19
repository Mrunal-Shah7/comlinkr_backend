import {
  BadRequestException,
  ConflictException, // SPRINT-38: Translate duplicate event-review constraints into a client conflict.
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode'; // SPRINT-28
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  PaginationDto,
  createPaginationMeta,
} from '../../common/dto/pagination.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsQueryDto } from './dto/events-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { AttendEventDto } from './dto/attend-event.dto';
import { EventRegistrationStatus, TicketType } from '@prisma/client'; // SPRINT-38: Use persisted active/cancelled registration state.
import { CreateEventReviewDto } from './dto/create-event-review.dto'; // SPRINT-38: Type event review creation.
import { UpdateEventReviewDto } from './dto/update-event-review.dto'; // SPRINT-38: Type event review edits.
import {
  EventCheckInFilter,
  EventCheckInStatusDto,
} from './dto/event-checkin-status.dto'; // SPRINT-38: Type organiser status filtering and pagination.

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
  private async buildFileUrl(
    imageUrl: string | null | undefined,
  ): Promise<string> {
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
    const isAttending = currentUserId && (event.attendees?.length ?? 0) > 0;
    const savedByMe = currentUserId && (event.saves?.length ?? 0) > 0;
    const isSaved = !!savedByMe;
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
      averageRating: Number(event.averageRating ?? 0), // SPRINT-38: Match restaurant aggregate response naming and numeric shape.
      totalReviews: event.totalReviews ?? 0, // SPRINT-38: Expose denormalised event review count everywhere this formatter is used.
      createdAt: event.createdAt,
      images,
      author: {
        id: event.author.id,
        username: event.author.username,
        name: event.author.fullName,
        avatarUrl: event.author.avatarUrl
          ? await this.buildFileUrl(event.author.avatarUrl)
          : null,
        badges: (event.author.userBadges ?? []).map(
          (b: { badgeType: string }) => ({
            badgeType: b.badgeType,
          }),
        ),
      },
      isAttending: !!isAttending,
      /** Mobile alias for RSVP state */
      registeredByMe: !!isAttending,
      savedByMe,
      isSaved,
      isFull,
      isOwner: currentUserId ? event.authorId === currentUserId : false,
      spotsLeft,
      conversationId: event.conversationId ?? null,
      canAccessChat: !!(
        event.conversationId &&
        currentUserId &&
        (event.authorId === currentUserId || !!isAttending)
      ),
      ...(event.reviews !== undefined // SPRINT-38: Add caller review state only when the detail query requested it.
        ? {
            // SPRINT-38: Keep detail state in the existing formatted event response.
            hasReviewed: event.reviews.length > 0, // SPRINT-38: Let clients choose create versus edit UI without another request.
            myReviewId: event.reviews[0]?.id ?? null, // SPRINT-38: Return the caller's compound-unique review identifier.
          } // SPRINT-38: Complete detail-only review state.
        : {}), // SPRINT-38: Avoid claiming false review state on list queries that did not load it.
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
              userBadges: { select: { badgeType: true } },
            },
          },
          attendees: {
            where: { userId, status: EventRegistrationStatus.ACTIVE }, // SPRINT-38: Exclude cancelled registrations from list attendance state.
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
            userBadges: { select: { badgeType: true } },
          },
        },
        attendees: {
          where: { userId, status: EventRegistrationStatus.ACTIVE }, // SPRINT-38: Exclude cancelled registrations from detail attendance state.
          select: { id: true },
        },
        saves: {
          where: { userId },
          select: { id: true },
        },
        eventImages: { orderBy: { order: 'asc' } },
        reviews: {
          // SPRINT-38: Resolve the caller's own review in the event detail query.
          where: { userId }, // SPRINT-38: Scope directly to the acting user.
          select: { id: true }, // SPRINT-38: Fetch only the identifier required by detail UI.
          take: 1, // SPRINT-38: Bound the relation despite the database compound unique constraint.
        }, // SPRINT-38: Complete single scoped review relation query.
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

  private async formatEventReview(review: {
    // SPRINT-38: Reuse the restaurant review response shape.
    id: string; // SPRINT-38: Review identifier.
    rating: number; // SPRINT-38: Integer star rating.
    content: string; // SPRINT-38: Review body.
    createdAt: Date; // SPRINT-38: Creation timestamp.
    user: {
      // SPRINT-38: Public reviewer profile.
      id: string; // SPRINT-38: Reviewer identifier.
      username: string; // SPRINT-38: Reviewer handle.
      fullName: string; // SPRINT-38: Reviewer display name.
      avatarUrl: string | null; // SPRINT-38: Stored reviewer avatar reference.
    }; // SPRINT-38: End reviewer shape.
  }) {
    // SPRINT-38: Format a loaded event review.
    return {
      // SPRINT-38: Match FoodService.formatReviewResponse.
      id: review.id, // SPRINT-38: Return review identifier.
      rating: review.rating, // SPRINT-38: Return rating.
      content: review.content, // SPRINT-38: Return content.
      createdAt: review.createdAt, // SPRINT-38: Return creation timestamp.
      author: {
        // SPRINT-38: Match restaurant author nesting.
        id: review.user.id, // SPRINT-38: Return reviewer identifier.
        username: review.user.username, // SPRINT-38: Return reviewer handle.
        name: review.user.fullName, // SPRINT-38: Match restaurant response's name alias.
        avatarUrl: review.user.avatarUrl // SPRINT-38: Resolve a readable avatar URL when present.
          ? await this.buildFileUrl(review.user.avatarUrl) // SPRINT-38: Use the existing storage URL helper.
          : null, // SPRINT-38: Preserve a null absent avatar.
      }, // SPRINT-38: End author response.
    }; // SPRINT-38: End review response.
  } // SPRINT-38: End event review formatter.

  private eventHasEnded(event: {
    // SPRINT-38: Interpret existing date/time fields without adding incompatible event fields.
    date: Date; // SPRINT-38: Existing date-only event value.
    startTime: string; // SPRINT-38: Required fallback time.
    endTime: string | null; // SPRINT-38: Preferred event completion time.
  }): boolean {
    // SPRINT-38: Return whether review eligibility has begun.
    const endedAt = new Date(event.date); // SPRINT-38: Start from the persisted event date.
    const value = (event.endTime ?? event.startTime).trim(); // SPRINT-38: Prefer end time and fall back to start time.
    const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i); // SPRINT-38: Support the app's documented 12-hour strings and 24-hour values.
    if (!match) return endedAt.getTime() < Date.now(); // SPRINT-38: Conservatively use the persisted date when legacy time text is unparsable.
    let hour = Number(match[1]); // SPRINT-38: Parse the supplied hour.
    const minute = Number(match[2] ?? 0); // SPRINT-38: Default an omitted minute to zero.
    const meridiem = match[3]?.toUpperCase(); // SPRINT-38: Normalize AM/PM.
    if (meridiem === 'AM' && hour === 12) hour = 0; // SPRINT-38: Convert midnight to 24-hour time.
    if (meridiem === 'PM' && hour < 12) hour += 12; // SPRINT-38: Convert afternoon values to 24-hour time.
    if (hour > 23 || minute > 59) return endedAt.getTime() < Date.now(); // SPRINT-38: Fall back for invalid legacy clock values.
    endedAt.setHours(hour, minute, 0, 0); // SPRINT-38: Follow the service's existing server-local date semantics.
    return endedAt.getTime() < Date.now(); // SPRINT-38: Permit reviews only after the interpreted end instant.
  } // SPRINT-38: End event completion helper.

  private async runEventReviewTransaction<T>( // SPRINT-38: Serialize review mutations so concurrent aggregate recalculations cannot overwrite each other.
    operation: (tx: Prisma.TransactionClient) => Promise<T>, // SPRINT-38: Accept one atomic review mutation and recalculation.
  ): Promise<T> {
    // SPRINT-38: Return the mutation result after any safe retry.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // SPRINT-38: Retry bounded PostgreSQL serialization conflicts.
      try {
        // SPRINT-38: Attempt the mutation at serializable isolation.
        return await this.prisma.$transaction(operation, {
          // SPRINT-38: Prevent concurrent review transactions from committing stale aggregates.
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, // SPRINT-38: Make aggregate rows reflect a serial mutation order.
        }); // SPRINT-38: Complete the serializable transaction attempt.
      } catch (error) {
        // SPRINT-38: Inspect retryable database conflicts.
        const retryable = // SPRINT-38: Restrict retries to Prisma transaction write conflicts.
          error instanceof Prisma.PrismaClientKnownRequestError && // SPRINT-38: Narrow to known Prisma errors.
          error.code === 'P2034'; // SPRINT-38: Match transaction conflict/deadlock failures.
        if (!retryable || attempt === 2) throw error; // SPRINT-38: Preserve non-retryable errors and bound retries.
      } // SPRINT-38: End transaction attempt.
    } // SPRINT-38: End bounded retry loop.
    throw new Error('Event review transaction retry limit exceeded'); // SPRINT-38: Satisfy total return typing; the loop always returns or throws.
  } // SPRINT-38: End serial review transaction helper.

  private async recalculateEventReviewAggregates(
    // SPRINT-38: Recompute aggregates from review rows after every mutation.
    tx: Prisma.TransactionClient, // SPRINT-38: Keep review and aggregate writes in one transaction.
    eventId: string, // SPRINT-38: Scope aggregation to one event.
  ) {
    // SPRINT-38: Recalculate mean and count using the database.
    const aggregate = await tx.eventReview.aggregate({
      // SPRINT-38: Avoid loading reviews into application memory.
      where: { eventId }, // SPRINT-38: Aggregate only this event's reviews.
      _avg: { rating: true }, // SPRINT-38: Ask the database for the exact current mean.
      _count: { _all: true }, // SPRINT-38: Ask the database for the current row count.
    }); // SPRINT-38: Complete event review aggregation.
    await tx.event.update({
      // SPRINT-38: Persist denormalised aggregate fields.
      where: { id: eventId }, // SPRINT-38: Update the reviewed event.
      data: {
        // SPRINT-38: Write both aggregates together.
        averageRating: aggregate._avg.rating ?? 0, // SPRINT-38: Match restaurant zero behavior when no reviews remain.
        totalReviews: aggregate._count._all, // SPRINT-38: Store the exact database count.
      }, // SPRINT-38: End aggregate update data.
    }); // SPRINT-38: Complete aggregate persistence.
  } // SPRINT-38: End aggregate recalculation.

  async createEventReview(
    // SPRINT-38: Create one post-event attendee review.
    userId: string, // SPRINT-38: Acting attendee.
    eventId: string, // SPRINT-38: Reviewed event.
    dto: CreateEventReviewDto, // SPRINT-38: Validated rating and content.
  ) {
    // SPRINT-38: Enforce event-specific review eligibility.
    const event = await this.prisma.event.findUnique({
      // SPRINT-38: Load event and caller registration once.
      where: { id: eventId }, // SPRINT-38: Resolve the path event.
      select: {
        // SPRINT-38: Fetch only eligibility fields.
        id: true, // SPRINT-38: Confirm event existence.
        authorId: true, // SPRINT-38: Prevent organiser self-review.
        date: true, // SPRINT-38: Determine whether the event occurred.
        startTime: true, // SPRINT-38: Fallback completion time.
        endTime: true, // SPRINT-38: Preferred completion time.
        attendees: {
          // SPRINT-38: Verify active registration.
          where: { userId, status: EventRegistrationStatus.ACTIVE }, // SPRINT-38: Cancelled registrations are not attendees.
          select: { id: true }, // SPRINT-38: Existence is sufficient.
          take: 1, // SPRINT-38: Bound relation data.
        }, // SPRINT-38: End attendee relation selection.
      }, // SPRINT-38: End event eligibility selection.
    }); // SPRINT-38: Complete event lookup.
    if (!event) {
      // SPRINT-38: Match restaurant missing-parent behavior.
      throw new NotFoundException({
        // SPRINT-38: Return structured not found.
        code: 'RESOURCE_NOT_FOUND', // SPRINT-38: Match existing API error code.
        message: 'Event not found', // SPRINT-38: Explain the missing event.
      }); // SPRINT-38: Complete missing event exception.
    } // SPRINT-38: End existence check.
    if (event.attendees.length === 0) {
      // SPRINT-38: Restrict reviews to active registered attendees.
      throw new ForbiddenException({
        // SPRINT-38: Reject non-attendee reviews.
        code: 'FORBIDDEN', // SPRINT-38: Use existing authorization code.
        message: 'Only attendees may review an event.', // SPRINT-38: Provide the required actionable message.
      }); // SPRINT-38: Complete attendee exception.
    } // SPRINT-38: End attendee eligibility check.
    if (!this.eventHasEnded(event)) {
      // SPRINT-38: Prevent pre-event feedback.
      throw new BadRequestException({
        // SPRINT-38: Treat timing as an invalid request.
        code: 'BAD_REQUEST', // SPRINT-38: Match existing validation errors.
        message: 'An event may only be reviewed after it has taken place.', // SPRINT-38: State the review timing rule.
      }); // SPRINT-38: Complete timing exception.
    } // SPRINT-38: End completion check.
    if (event.authorId === userId) {
      // SPRINT-38: Block organiser self-dealing.
      throw new ForbiddenException({
        // SPRINT-38: Treat self-review as unauthorized.
        code: 'FORBIDDEN', // SPRINT-38: Return a machine-readable authorization code.
        message: 'Organisers cannot review their own event.', // SPRINT-38: Explain the restriction.
      }); // SPRINT-38: Complete organiser exception.
    } // SPRINT-38: End organiser check.
    try {
      // SPRINT-38: Catch the database uniqueness guarantee explicitly.
      const review = await this.runEventReviewTransaction(async (tx) => {
        // SPRINT-38: Serialize creation with exact aggregate recalculation.
        // SPRINT-38: Keep review creation and aggregate recalculation atomic.
        const created = await tx.eventReview.create({
          // SPRINT-38: Let the compound unique constraint decide duplicates.
          data: { eventId, userId, rating: dto.rating, content: dto.content }, // SPRINT-38: Persist restaurant-equivalent fields.
          include: {
            // SPRINT-38: Load public reviewer fields for the response.
            user: {
              // SPRINT-38: Include review author.
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              }, // SPRINT-38: Match restaurant formatter fields.
            }, // SPRINT-38: End user include.
          }, // SPRINT-38: End response include.
        }); // SPRINT-38: Complete review creation.
        await this.recalculateEventReviewAggregates(tx, eventId); // SPRINT-38: Recompute exact aggregates after creation.
        return created; // SPRINT-38: Return the created review from the transaction.
      }); // SPRINT-38: Complete atomic create.
      return this.formatEventReview(review); // SPRINT-38: Return the reusable restaurant-shaped response.
    } catch (error) {
      // SPRINT-38: Inspect database errors without masking unrelated failures.
      if (
        // SPRINT-38: Identify only Prisma unique-constraint failures.
        error instanceof Prisma.PrismaClientKnownRequestError && // SPRINT-38: Narrow to known Prisma request errors.
        error.code === 'P2002' // SPRINT-38: Match the compound unique violation.
      ) {
        // SPRINT-38: Translate duplicate event review.
        throw new ConflictException({
          // SPRINT-38: Return HTTP 409 instead of a raw database error.
          code: 'DUPLICATE_ENTRY', // SPRINT-38: Match restaurant duplicate semantics.
          message: 'You have already reviewed this event.', // SPRINT-38: Explain the one-review rule.
        }); // SPRINT-38: Complete duplicate exception.
      } // SPRINT-38: End unique violation handling.
      throw error; // SPRINT-38: Preserve all non-duplicate failures.
    } // SPRINT-38: End review creation error handling.
  } // SPRINT-38: End create event review.

  async getEventReviews(eventId: string, query: PaginationDto) {
    // SPRINT-38: List event reviews in the restaurant pagination envelope.
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    }); // SPRINT-38: Verify the parent event exists.
    if (!event) {
      // SPRINT-38: Match restaurant list behavior.
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      }); // SPRINT-38: Return structured missing-event error.
    } // SPRINT-38: End event existence check.
    const page = query.page ?? 1; // SPRINT-38: Use standard first-page default.
    const limit = query.limit ?? 20; // SPRINT-38: Use standard review page size.
    const [items, total] = await this.prisma.$transaction([
      // SPRINT-38: Read page and count consistently.
      this.prisma.eventReview.findMany({
        // SPRINT-38: Load the requested review page.
        where: { eventId }, // SPRINT-38: Scope reviews to the event.
        orderBy: { createdAt: 'desc' }, // SPRINT-38: Match restaurant newest-first ordering.
        skip: (page - 1) * limit, // SPRINT-38: Apply page offset.
        take: limit, // SPRINT-38: Apply page size.
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        }, // SPRINT-38: Load public reviewer fields.
      }), // SPRINT-38: Complete page query.
      this.prisma.eventReview.count({ where: { eventId } }), // SPRINT-38: Count all reviews for pagination metadata.
    ]); // SPRINT-38: Complete list transaction.
    const data = await Promise.all(
      items.map((review) => this.formatEventReview(review)),
    ); // SPRINT-38: Resolve all restaurant-shaped review responses.
    return { data, meta: createPaginationMeta(page, limit, total) }; // SPRINT-38: Match the standard pagination envelope.
  } // SPRINT-38: End list event reviews.

  async updateEventReview(
    // SPRINT-38: Edit an event review by identifier.
    userId: string, // SPRINT-38: Acting user.
    eventId: string, // SPRINT-38: Parent event path identifier.
    reviewId: string, // SPRINT-38: Target review identifier.
    dto: UpdateEventReviewDto, // SPRINT-38: Optional replacement fields.
  ) {
    // SPRINT-38: Enforce author-only editing.
    if (dto.rating === undefined && dto.content === undefined) {
      // SPRINT-38: Match restaurant empty-update rejection.
      throw new BadRequestException('Provide at least one field to update'); // SPRINT-38: Reuse the exact restaurant message.
    } // SPRINT-38: End empty update check.
    const existing = await this.prisma.eventReview.findFirst({
      // SPRINT-38: Resolve review within its path event.
      where: { id: reviewId, eventId }, // SPRINT-38: Prevent cross-event review targeting.
      select: { id: true, userId: true }, // SPRINT-38: Fetch ownership only.
    }); // SPRINT-38: Complete review lookup.
    if (!existing) {
      // SPRINT-38: Reject missing or mismatched reviews.
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event review not found',
      }); // SPRINT-38: Return structured not found.
    } // SPRINT-38: End existence check.
    if (existing.userId !== userId) {
      // SPRINT-38: Organisers and third parties cannot edit another attendee's words.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own event review.',
      }); // SPRINT-38: Explain author-only editing.
    } // SPRINT-38: End edit authorization.
    const updated = await this.runEventReviewTransaction(async (tx) => {
      // SPRINT-38: Serialize edits with exact aggregate recalculation.
      // SPRINT-38: Keep edit and aggregate recomputation atomic.
      const review = await tx.eventReview.update({
        // SPRINT-38: Apply supplied review fields.
        where: { id: reviewId }, // SPRINT-38: Update the authorized review.
        data: {
          // SPRINT-38: Preserve omitted fields.
          ...(dto.rating !== undefined ? { rating: dto.rating } : {}), // SPRINT-38: Replace rating only when provided.
          ...(dto.content !== undefined ? { content: dto.content } : {}), // SPRINT-38: Replace content only when provided.
        }, // SPRINT-38: End review update data.
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        }, // SPRINT-38: Load response author.
      }); // SPRINT-38: Complete review update.
      await this.recalculateEventReviewAggregates(tx, eventId); // SPRINT-38: Recompute aggregates after every edit.
      return review; // SPRINT-38: Return updated review.
    }); // SPRINT-38: Complete atomic review edit.
    return this.formatEventReview(updated); // SPRINT-38: Return restaurant-shaped updated review.
  } // SPRINT-38: End update event review.

  async deleteEventReview(userId: string, eventId: string, reviewId: string) {
    // SPRINT-38: Delete by review identifier.
    const existing = await this.prisma.eventReview.findFirst({
      // SPRINT-38: Load review and organiser ownership.
      where: { id: reviewId, eventId }, // SPRINT-38: Scope the review to the path event.
      select: { id: true, userId: true, event: { select: { authorId: true } } }, // SPRINT-38: Fetch author and organiser IDs.
    }); // SPRINT-38: Complete delete target lookup.
    if (!existing) {
      // SPRINT-38: Reject missing or cross-event targets.
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event review not found',
      }); // SPRINT-38: Return structured not found.
    } // SPRINT-38: End existence check.
    if (existing.userId !== userId && existing.event.authorId !== userId) {
      // SPRINT-38: Permit only author or owning organiser.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message:
          'Only the review author or event organiser may delete this review.',
      }); // SPRINT-38: Explain delete authorization.
    } // SPRINT-38: End delete authorization.
    await this.runEventReviewTransaction(async (tx) => {
      // SPRINT-38: Serialize deletion with exact aggregate recalculation.
      // SPRINT-38: Keep deletion and aggregates atomic.
      await tx.eventReview.delete({ where: { id: reviewId } }); // SPRINT-38: Remove the authorized review.
      await this.recalculateEventReviewAggregates(tx, eventId); // SPRINT-38: Recompute aggregates including the zero-review case.
    }); // SPRINT-38: Complete atomic review deletion.
    return { deleted: true }; // SPRINT-38: Match restaurant delete response.
  } // SPRINT-38: End delete event review.

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
          where: { userId, status: EventRegistrationStatus.ACTIVE }, // SPRINT-38: Exclude cancelled registrations from created-event state.
          select: { id: true },
        },
        saves: {
          where: { userId },
          select: { id: true },
        },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    this.notifyEventNearby(
      created.id,
      created.title,
      created.city,
      userId,
    ).catch(() => {});
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

  private async notifyEventNearby(
    eventId: string,
    eventTitle: string,
    city: string,
    excludeUserId: string,
  ) {
    const usersInCity = await this.prisma.userLocation.findMany({
      where: {
        city: { equals: city, mode: 'insensitive' },
        userId: { not: excludeUserId },
      },
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

  async attendEvent(userId: string, eventId: string, dto: AttendEventDto = {}) {
    const tickets =
      dto.ticketCount != null && dto.ticketCount > 0 ? dto.ticketCount : 1;
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        attendees: {
          where: { userId, status: EventRegistrationStatus.ACTIVE },
          select: { id: true },
        }, // SPRINT-38: Treat only active registrations as attendance.
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
        conversationId: event.conversationId ?? null,
      };
    }
    const capacity = event.capacity;
    if (capacity != null && event.attendeeCount + tickets > capacity) {
      const left = Math.max(0, capacity - event.attendeeCount);
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Not enough spots remaining. Only ${left} spot${left === 1 ? '' : 's'} left.`,
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.event.findUnique({
          where: { id: eventId },
          select: {
            id: true,
            title: true,
            authorId: true,
            attendeeCount: true,
            capacity: true,
            conversationId: true,
          },
        });
        if (!fresh) {
          throw new NotFoundException({
            code: 'RESOURCE_NOT_FOUND',
            message: 'Event not found',
          });
        }
        if (fresh.authorId === userId) {
          throw new BadRequestException({
            code: 'BAD_REQUEST',
            message: 'You cannot RSVP to your own event.',
          });
        }

        const existingAttendee = await tx.eventAttendee.findUnique({
          where: { eventId_userId: { eventId, userId } },
        });
        if (existingAttendee?.status === EventRegistrationStatus.ACTIVE) {
          // SPRINT-38: Preserve idempotency only for an active registration.
          const e2 = await tx.event.findUnique({
            where: { id: eventId },
            select: { attendeeCount: true, conversationId: true },
          });
          return {
            attending: true,
            attendeeCount: e2!.attendeeCount,
            conversationId: e2!.conversationId,
          };
        }

        if (
          fresh.capacity != null &&
          fresh.attendeeCount + tickets > fresh.capacity
        ) {
          const left = Math.max(0, fresh.capacity - fresh.attendeeCount);
          throw new BadRequestException({
            code: 'BAD_REQUEST',
            message: `Not enough spots remaining. Only ${left} spot${left === 1 ? '' : 's'} left.`,
          });
        }

        const preCount = fresh.attendeeCount;

        if (existingAttendee) {
          // SPRINT-38: Reactivate the retained cancelled registration and its stable Sprint 28 ticket UUID.
          await tx.eventAttendee.update({
            // SPRINT-38: Restore admission without issuing a second identifier.
            where: { id: existingAttendee.id }, // SPRINT-38: Reuse the same registration row.
            data: {
              // SPRINT-38: Refresh registration details for the new RSVP.
              status: EventRegistrationStatus.ACTIVE, // SPRINT-38: Grant admission again.
              cancelledAt: null, // SPRINT-38: Clear prior cancellation state.
              checkedInAt: null, // SPRINT-38: Start the reactivated registration unredeemed.
              checkedInById: null, // SPRINT-38: Clear any prior checker.
              joinedAt: new Date(), // SPRINT-38: Reflect the latest registration time.
              attendeeName: dto.attendeeName?.trim() || null, // SPRINT-38: Refresh RSVP name.
              attendeeEmail: dto.attendeeEmail?.trim() || null, // SPRINT-38: Refresh RSVP email.
              attendeePhone: dto.attendeePhone?.trim() || null, // SPRINT-38: Refresh RSVP phone.
              ticketCount: tickets, // SPRINT-38: Refresh ticket quantity.
            }, // SPRINT-38: End reactivation data.
          }); // SPRINT-38: Complete registration reactivation.
        } else {
          // SPRINT-38: Create the first registration using the existing UUID default.
          await tx.eventAttendee.create({
            // SPRINT-38: Persist a new stable ticket identity.
            data: {
              // SPRINT-38: Store RSVP details.
              eventId, // SPRINT-38: Link registration to the event.
              userId, // SPRINT-38: Link registration to the attendee.
              attendeeName: dto.attendeeName?.trim() || null, // SPRINT-38: Store optional RSVP name.
              attendeeEmail: dto.attendeeEmail?.trim() || null, // SPRINT-38: Store optional RSVP email.
              attendeePhone: dto.attendeePhone?.trim() || null, // SPRINT-38: Store optional RSVP phone.
              ticketCount: tickets, // SPRINT-38: Store admitted ticket quantity.
            }, // SPRINT-38: End new registration data.
          }); // SPRINT-38: Complete first registration.
        } // SPRINT-38: End create/reactivate branch.
        await tx.event.update({
          where: { id: eventId },
          data: { attendeeCount: { increment: tickets } },
        });

        const post = await tx.event.findUnique({
          where: { id: eventId },
          select: {
            attendeeCount: true,
            conversationId: true,
            title: true,
            authorId: true,
          },
        });
        if (!post) {
          throw new NotFoundException({
            code: 'RESOURCE_NOT_FOUND',
            message: 'Event not found',
          });
        }

        if (post.conversationId) {
          const cid = post.conversationId;
          const memberExists = await tx.conversationMember.findUnique({
            where: {
              conversationId_userId: { conversationId: cid, userId },
            },
          });
          if (!memberExists) {
            const u = await tx.user.findUnique({
              where: { id: userId },
              select: { username: true },
            });
            const uname = u?.username ?? 'Someone';
            await tx.conversationMember.create({
              data: {
                conversationId: cid,
                userId,
                role: 'MEMBER',
                status: 'ACCEPTED',
              },
            });
            await tx.message.create({
              data: {
                conversationId: cid,
                senderId: userId,
                content: `${uname} joined the event`,
                type: 'SYSTEM',
              },
            });
          }
          return {
            attending: true,
            attendeeCount: post.attendeeCount,
            conversationId: cid,
          };
        }

        if (preCount === 0) {
          const conv = await tx.conversation.create({
            data: {
              type: 'GROUP',
              title: post.title,
              contextType: 'EVENT',
              contextId: eventId,
              createdById: post.authorId,
            },
          });
          await tx.conversationMember.createMany({
            data: [
              {
                conversationId: conv.id,
                userId: post.authorId,
                role: 'ADMIN',
                status: 'ACCEPTED',
              },
              {
                conversationId: conv.id,
                userId,
                role: 'MEMBER',
                status: 'ACCEPTED',
              },
            ],
          });
          const welcome = `Welcome to the ${post.title} event chat! Say hi to your fellow attendees 👋`;
          await tx.message.create({
            data: {
              conversationId: conv.id,
              senderId: post.authorId,
              content: welcome,
              type: 'SYSTEM',
            },
          });
          await tx.event.update({
            where: { id: eventId },
            data: { conversationId: conv.id },
          });
          return {
            attending: true,
            attendeeCount: post.attendeeCount,
            conversationId: conv.id,
          };
        }

        return {
          attending: true,
          attendeeCount: post.attendeeCount,
          conversationId: post.conversationId,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      },
    );
  }

  async cancelAttendance(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { attendeeCount: true, conversationId: true },
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
      select: { id: true, ticketCount: true, status: true }, // SPRINT-38: Keep cancelled rows idempotent without decrementing twice.
    });
    if (!attendee || attendee.status === EventRegistrationStatus.CANCELLED) {
      // SPRINT-38: Treat missing and already-cancelled registrations as not attending.
      return {
        attending: false,
        attendeeCount: event.attendeeCount,
        conversationId: event.conversationId,
      };
    }

    const leaver = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const leaverName = leaver?.username ?? 'Someone';

    const ticketCount = Math.max(1, attendee.ticketCount ?? 1);

    const newCount = await this.prisma.$transaction(async (tx) => {
      const ev = await tx.event.findUnique({
        where: { id: eventId },
        select: { attendeeCount: true, conversationId: true },
      });
      if (!ev) {
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Event not found',
        });
      }

      if (ev.conversationId) {
        const mem = await tx.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: ev.conversationId,
              userId,
            },
          },
        });
        if (mem) {
          await tx.conversationMember.delete({
            where: { id: mem.id },
          });
          await tx.message.create({
            data: {
              conversationId: ev.conversationId,
              senderId: userId,
              content: `${leaverName} left the event`,
              type: 'SYSTEM',
            },
          });
        }
      }

      await tx.eventAttendee.update({
        // SPRINT-38: Retain the stable ticket UUID for a distinct cancelled scan result.
        where: { id: attendee.id }, // SPRINT-38: Update the active registration.
        data: {
          // SPRINT-38: Revoke admission while preserving its audit identity.
          status: EventRegistrationStatus.CANCELLED, // SPRINT-38: Mark ticket cancelled.
          cancelledAt: new Date(), // SPRINT-38: Record cancellation time.
        }, // SPRINT-38: End cancellation state.
      }); // SPRINT-38: Complete soft cancellation.
      const next = Math.max(0, ev.attendeeCount - ticketCount);
      await tx.event.update({
        where: { id: eventId },
        data: { attendeeCount: next },
      });
      return next;
    });

    const after = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { conversationId: true },
    });

    return {
      attending: false,
      attendeeCount: newCount,
      conversationId: after?.conversationId ?? null,
    };
  }

  /** Mobile: same as attend; response uses { registered, attendees }. */
  async registerForEvent(
    userId: string,
    eventId: string,
    dto: AttendEventDto = {},
  ) {
    const r = await this.attendEvent(userId, eventId, dto);
    return {
      registered: r.attending,
      attendees: r.attendeeCount,
      conversationId: r.conversationId ?? null,
    };
  }

  async cancelRegistration(userId: string, eventId: string) {
    const r = await this.cancelAttendance(userId, eventId);
    return {
      registered: r.attending,
      attendees: r.attendeeCount,
      conversationId: r.conversationId ?? null,
    };
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
        attendees: {
          where: { userId, status: EventRegistrationStatus.ACTIVE },
          select: { id: true },
        }, // SPRINT-38: Exclude cancelled registrations from story RSVP state.
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
        image: e.eventImages[0]?.imageUrl
          ? await this.buildFileUrl(e.eventImages[0].imageUrl)
          : (undefined as string | undefined),
        attendees: e.attendeeCount,
        averageRating: Number(e.averageRating ?? 0), // SPRINT-38: Expose ratings in the lightweight feed event response.
        totalReviews: e.totalReviews ?? 0, // SPRINT-38: Expose review count in the lightweight feed event response.
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
        attendees: {
          where: { userId, status: EventRegistrationStatus.ACTIVE },
          select: { id: true },
        }, // SPRINT-38: Exclude cancelled registrations from owner event responses.
        saves: { where: { userId }, select: { id: true } },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    return Promise.all(items.map((e) => this.formatEvent(e, userId)));
  }

  async getRegisteredEvents(userId: string) {
    const rows = await this.prisma.eventAttendee.findMany({
      where: { userId, status: EventRegistrationStatus.ACTIVE }, // SPRINT-38: Return only currently registered events.
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
            attendees: {
              where: { userId, status: EventRegistrationStatus.ACTIVE },
              select: { id: true },
            }, // SPRINT-38: Keep registered event state active-only.
            saves: { where: { userId }, select: { id: true } },
            eventImages: { orderBy: { order: 'asc' } },
          },
        },
      },
    });
    return Promise.all(rows.map((r) => this.formatEvent(r.event, userId)));
  }

  async getSavedEvents(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
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
              attendees: {
                where: { userId, status: EventRegistrationStatus.ACTIVE },
                select: { id: true },
              }, // SPRINT-38: Exclude cancelled registrations from saved-event state.
              saves: { where: { userId }, select: { id: true } },
              eventImages: { orderBy: { order: 'asc' } },
            },
          },
        },
      }),
      this.prisma.eventSave.count({ where: { userId } }),
    ]);
    const data = await Promise.all(
      rows.map((r) => this.formatEvent(r.event, userId)),
    );
    return { data, meta: createPaginationMeta(page, limit, total) };
  }

  async toggleSaveEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
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
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
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
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
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
        attendees: {
          where: { userId, status: EventRegistrationStatus.ACTIVE },
          select: { id: true },
        }, // SPRINT-38: Exclude cancelled registrations from updated-event state.
        saves: { where: { userId }, select: { id: true } },
        eventImages: { orderBy: { order: 'asc' } },
      },
    });
    return await this.formatEvent(updated, userId);
  }

  async deleteEvent(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
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
        message: 'Only the host can delete this event.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const ev = await tx.event.findUnique({
        where: { id: eventId },
        select: { conversationId: true },
      });
      const cid = ev?.conversationId;
      if (cid) {
        await tx.conversationMember.deleteMany({
          where: { conversationId: cid },
        });
        await tx.message.deleteMany({ where: { conversationId: cid } });
        await tx.conversation.delete({ where: { id: cid } });
      }
      await tx.eventSave.deleteMany({ where: { eventId } });
      await tx.eventAttendee.deleteMany({ where: { eventId } });
      await tx.event.delete({ where: { id: eventId } });
    });
    return { ok: true };
  }

  async getEventAttendees(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        attendees: {
          where: { status: EventRegistrationStatus.ACTIVE }, // SPRINT-38: List only currently registered attendees to the host.
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                email: true,
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
        attendeeName: a.attendeeName ?? a.user.fullName,
        attendeeEmail: a.attendeeEmail ?? a.user.email,
        attendeePhone: a.attendeePhone ?? null,
        ticketCount: a.ticketCount,
      })),
    );
  }

  async getMyTicket(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        attendees: {
          where: { userId, status: EventRegistrationStatus.ACTIVE }, // SPRINT-38: Do not issue a usable QR response for a cancelled registration.
          select: { id: true, joinedAt: true, ticketCount: true },
        },
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
    const attendee = event.attendees[0];
    // SPRINT-28: generate real base64 PNG QR from ticket payload
    let qrCode: string | null = null;
    try {
      const payload = JSON.stringify({
        eventId: event.id,
        attendeeId: attendee.id,
        userId,
        eventTitle: event.title,
      });
      const dataUrl = await QRCode.toDataURL(payload);
      qrCode = dataUrl.split(',')[1] ?? null;
    } catch {
      qrCode = null;
    }
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
      quantity: Math.max(1, attendee.ticketCount ?? 1),
      totalPrice: Number(event.ticketPrice ?? 0),
      qrCode,
      issuedAt: attendee.joinedAt.toISOString(),
    };
  }

  private async formatCheckInAttendee(registration: {
    // SPRINT-38: Produce the door-safe attendee identity shared by all known-ticket outcomes.
    id: string; // SPRINT-38: Stable Sprint 28 ticket identifier.
    ticketCount: number; // SPRINT-38: Number of people represented by the registration.
    attendeeName: string | null; // SPRINT-38: Optional RSVP display name.
    attendeeEmail: string | null; // SPRINT-38: Optional RSVP contact email.
    attendeePhone: string | null; // SPRINT-38: Optional RSVP contact phone.
    user: {
      // SPRINT-38: Public account identity.
      id: string; // SPRINT-38: Account identifier.
      username: string; // SPRINT-38: Account handle.
      fullName: string; // SPRINT-38: Account display name.
      avatarUrl: string | null; // SPRINT-38: Stored avatar reference.
      email: string; // SPRINT-38: Account email fallback for RSVP display.
    }; // SPRINT-38: End attendee user shape.
  }) {
    // SPRINT-38: Format scanner attendee context.
    return {
      // SPRINT-38: Return immediately intelligible identity details.
      id: registration.user.id, // SPRINT-38: Return attendee account ID.
      ticketId: registration.id, // SPRINT-38: Return the redeemed registration UUID.
      name: registration.attendeeName ?? registration.user.fullName, // SPRINT-38: Prefer submitted ticket name.
      username: registration.user.username, // SPRINT-38: Help the organiser disambiguate names.
      email: registration.attendeeEmail ?? registration.user.email, // SPRINT-38: Prefer submitted ticket email.
      phone: registration.attendeePhone, // SPRINT-38: Return RSVP phone when supplied.
      avatarUrl: registration.user.avatarUrl // SPRINT-38: Resolve attendee avatar for visual confirmation.
        ? await this.buildFileUrl(registration.user.avatarUrl) // SPRINT-38: Use existing storage URL handling.
        : null, // SPRINT-38: Preserve null when no avatar exists.
      ticketCount: registration.ticketCount, // SPRINT-38: Show party size at the door.
    }; // SPRINT-38: End scanner attendee response.
  } // SPRINT-38: End scanner attendee formatter.

  async checkInTicket(userId: string, eventId: string, ticketId: string) {
    // SPRINT-38: Validate and redeem one deployed Sprint 28 ticket.
    const event = await this.prisma.event.findUnique({
      // SPRINT-38: Resolve endpoint context before inspecting a ticket.
      where: { id: eventId }, // SPRINT-38: Load the path event.
      select: { id: true, title: true, authorId: true }, // SPRINT-38: Fetch existence, notification title, and organiser ownership.
    }); // SPRINT-38: Complete event lookup.
    if (!event) {
      // SPRINT-38: Keep endpoint misuse as an HTTP exception.
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      }); // SPRINT-38: Return structured event not found.
    } // SPRINT-38: End event existence check.
    if (event.authorId !== userId) {
      // SPRINT-38: No co-organiser model exists, so only Event.authorId may scan.
      throw new ForbiddenException({
        // SPRINT-38: Keep unauthorized endpoint use as an HTTP exception.
        code: 'FORBIDDEN', // SPRINT-38: Return standard authorization code.
        message: 'Only the organiser may check attendees in.', // SPRINT-38: Explain the host-only rule.
      }); // SPRINT-38: Complete organiser exception.
    } // SPRINT-38: End organiser authorization.
    const includeUser = {
      // SPRINT-38: Reuse the exact attendee profile selection across check-in reads.
      select: {
        // SPRINT-38: Limit account data to scanner response fields.
        id: true, // SPRINT-38: Attendee account ID.
        username: true, // SPRINT-38: Attendee handle.
        fullName: true, // SPRINT-38: Attendee display name.
        avatarUrl: true, // SPRINT-38: Attendee avatar.
        email: true, // SPRINT-38: Fallback ticket email.
      }, // SPRINT-38: End attendee account selection.
    } as const; // SPRINT-38: Preserve Prisma selection literal types.
    let registration = await this.prisma.eventAttendee.findUnique({
      // SPRINT-38: Resolve the opaque registration UUID globally.
      where: { id: ticketId }, // SPRINT-38: Use the existing QR attendeeId directly.
      include: { user: includeUser }, // SPRINT-38: Load attendee identity when the ticket is known.
    }); // SPRINT-38: Complete ticket lookup.
    if (!registration) {
      // SPRINT-38: Unknown values are ticket outcomes, not transport failures.
      return {
        // SPRINT-38: Return an HTTP-success rejection result.
        admitted: false, // SPRINT-38: Deny admission.
        reasonCode: 'INVALID_TICKET' as const, // SPRINT-38: Machine-readable unknown-ticket reason.
        message: 'Ticket not recognised.', // SPRINT-38: Door-friendly rejection message.
        attendee: null, // SPRINT-38: No identity is known for a random value.
      }; // SPRINT-38: End invalid ticket result.
    } // SPRINT-38: End unknown ticket check.
    const attendee = await this.formatCheckInAttendee(registration); // SPRINT-38: Prepare known attendee context once.
    if (registration.eventId !== eventId) {
      // SPRINT-38: Prevent a valid ticket from opening another event.
      return {
        // SPRINT-38: Return an HTTP-success wrong-event rejection.
        admitted: false, // SPRINT-38: Deny admission.
        reasonCode: 'WRONG_EVENT' as const, // SPRINT-38: Machine-readable event mismatch.
        message: 'This ticket is for a different event.', // SPRINT-38: Door-friendly mismatch message.
        attendee, // SPRINT-38: Show known ticket holder for diagnosis.
      }; // SPRINT-38: End wrong-event result.
    } // SPRINT-38: End event membership check.
    if (registration.checkedInAt) {
      // SPRINT-38: Reject replay before considering cancellation, matching the required order.
      return {
        // SPRINT-38: Return original redemption details.
        admitted: false, // SPRINT-38: Deny duplicate admission.
        reasonCode: 'ALREADY_CHECKED_IN' as const, // SPRINT-38: Machine-readable replay result.
        message: 'Ticket was already checked in.', // SPRINT-38: Door-friendly replay message.
        checkedInAt: registration.checkedInAt, // SPRINT-38: Show the first redemption time.
        attendee, // SPRINT-38: Show who used the ticket.
      }; // SPRINT-38: End replay result.
    } // SPRINT-38: End initial replay check.
    if (registration.status === EventRegistrationStatus.CANCELLED) {
      // SPRINT-38: Distinguish retained cancelled registrations from random IDs.
      return {
        // SPRINT-38: Return cancellation as an HTTP-success ticket outcome.
        admitted: false, // SPRINT-38: Deny cancelled admission.
        reasonCode: 'REGISTRATION_CANCELLED' as const, // SPRINT-38: Machine-readable cancellation reason.
        message: 'This registration was cancelled.', // SPRINT-38: Door-friendly cancellation message.
        attendee, // SPRINT-38: Show the known cancelled attendee.
      }; // SPRINT-38: End cancelled result.
    } // SPRINT-38: End cancellation check.
    const now = new Date(); // SPRINT-38: Use one timestamp for atomic redemption and response.
    const redeemed = await this.prisma.eventAttendee.updateMany({
      // SPRINT-38: Prevent simultaneous scans from both being admitted.
      where: {
        // SPRINT-38: Redeem only an active, unused ticket for this event.
        id: ticketId, // SPRINT-38: Target the scanned registration.
        eventId, // SPRINT-38: Reassert event membership in the write.
        status: EventRegistrationStatus.ACTIVE, // SPRINT-38: Exclude cancellation races.
        checkedInAt: null, // SPRINT-38: Enforce one-time redemption atomically.
      }, // SPRINT-38: End atomic redemption predicate.
      data: { checkedInAt: now, checkedInById: userId }, // SPRINT-38: Record first redemption and checking organiser.
    }); // SPRINT-38: Complete conditional redemption.
    if (redeemed.count === 0) {
      // SPRINT-38: Resolve a concurrent cancellation or scan deterministically.
      registration = await this.prisma.eventAttendee.findUnique({
        // SPRINT-38: Reload current ticket state after losing the race.
        where: { id: ticketId }, // SPRINT-38: Reload the scanned registration.
        include: { user: includeUser }, // SPRINT-38: Retain attendee context.
      }); // SPRINT-38: Complete race-state reload.
      if (registration?.checkedInAt) {
        // SPRINT-38: A competing scanner redeemed first.
        return {
          // SPRINT-38: Report replay with the winning timestamp.
          admitted: false, // SPRINT-38: Deny the losing concurrent scan.
          reasonCode: 'ALREADY_CHECKED_IN' as const, // SPRINT-38: Use the normal replay code.
          message: 'Ticket was already checked in.', // SPRINT-38: Keep scanner messaging consistent.
          checkedInAt: registration.checkedInAt, // SPRINT-38: Return the actual first redemption time.
          attendee: await this.formatCheckInAttendee(registration), // SPRINT-38: Return current attendee identity.
        }; // SPRINT-38: End concurrent replay result.
      } // SPRINT-38: End concurrent redemption check.
      return {
        // SPRINT-38: The remaining write race is cancellation.
        admitted: false, // SPRINT-38: Deny admission.
        reasonCode: 'REGISTRATION_CANCELLED' as const, // SPRINT-38: Report concurrent cancellation.
        message: 'This registration was cancelled.', // SPRINT-38: Keep cancellation messaging consistent.
        attendee: registration
          ? await this.formatCheckInAttendee(registration)
          : attendee, // SPRINT-38: Return the best known identity.
      }; // SPRINT-38: End race cancellation result.
    } // SPRINT-38: End conditional redemption race handling.
    this.notificationsService
      .createNotification({
        // SPRINT-38: Optionally confirm successful check-in in the attendee's notifications.
        userId: registration.userId, // SPRINT-38: Notify the admitted attendee.
        type: 'SYSTEM', // SPRINT-38: Use an always-enabled existing notification type.
        title: 'Event check-in confirmed', // SPRINT-38: State the successful action.
        body: `You were checked in to "${event.title}".`, // SPRINT-38: Identify the event.
        referenceType: 'EVENT', // SPRINT-38: Link notification context to the event.
        referenceId: eventId, // SPRINT-38: Provide event deep-link reference.
        actorId: userId, // SPRINT-38: Record the checking organiser.
      })
      .catch(() => {}); // SPRINT-38: Never turn successful door admission into an error because notification creation failed.
    return {
      // SPRINT-38: Return successful admission.
      admitted: true, // SPRINT-38: Explicitly permit entry.
      reasonCode: 'ADMITTED' as const, // SPRINT-38: Machine-readable success result.
      message: 'Ticket accepted. Attendee checked in.', // SPRINT-38: Door-friendly success message.
      checkedInAt: now, // SPRINT-38: Return first redemption time.
      attendee, // SPRINT-38: Show the admitted attendee.
    }; // SPRINT-38: End successful check-in result.
  } // SPRINT-38: End ticket check-in.

  async getEventCheckInStatus(
    // SPRINT-38: Return organiser check-in totals and a filterable registration page.
    userId: string, // SPRINT-38: Acting organiser.
    eventId: string, // SPRINT-38: Event dashboard context.
    query: EventCheckInStatusDto, // SPRINT-38: Standard pagination plus optional state filter.
  ) {
    // SPRINT-38: Build the check-in dashboard response.
    const event = await this.prisma.event.findUnique({
      // SPRINT-38: Resolve event ownership.
      where: { id: eventId }, // SPRINT-38: Load the requested event.
      select: { id: true, authorId: true }, // SPRINT-38: Fetch only authorization fields.
    }); // SPRINT-38: Complete event lookup.
    if (!event) {
      // SPRINT-38: Keep missing endpoint context as an exception.
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Event not found',
      }); // SPRINT-38: Return structured not found.
    } // SPRINT-38: End event existence check.
    if (event.authorId !== userId) {
      // SPRINT-38: Apply the same organiser-only rule as mutation.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the organiser may view check-in status.',
      }); // SPRINT-38: Explain dashboard authorization.
    } // SPRINT-38: End organiser authorization.
    const page = query.page ?? 1; // SPRINT-38: Use standard first-page default.
    const limit = query.limit ?? 20; // SPRINT-38: Use standard page size and maximum validation.
    const activeWhere: Prisma.EventAttendeeWhereInput = {
      // SPRINT-38: Exclude cancelled registrations from registered totals.
      eventId, // SPRINT-38: Scope dashboard to one event.
      status: EventRegistrationStatus.ACTIVE, // SPRINT-38: Count only current registrations.
    }; // SPRINT-38: End active registration predicate.
    const listWhere: Prisma.EventAttendeeWhereInput = {
      // SPRINT-38: Add the optional check-in filter.
      ...activeWhere, // SPRINT-38: Preserve event and active registration scope.
      ...(query.filter === EventCheckInFilter.CHECKED_IN // SPRINT-38: Select already admitted registrations when requested.
        ? { checkedInAt: { not: null } } // SPRINT-38: Require a redemption timestamp.
        : query.filter === EventCheckInFilter.REMAINING // SPRINT-38: Select registrations awaiting admission when requested.
          ? { checkedInAt: null } // SPRINT-38: Require no redemption timestamp.
          : {}), // SPRINT-38: Include all active registrations by default.
    }; // SPRINT-38: End filtered list predicate.
    const [totalAggregate, checkedInAggregate, filteredTotal, registrations] = // SPRINT-38: Count admitted people by ticket quantity while paginating registration rows.
      await this.prisma.$transaction([
        // SPRINT-38: Read dashboard totals and page consistently.
        this.prisma.eventAttendee.aggregate({
          // SPRINT-38: Sum active ticket quantities for total registered people.
          where: activeWhere, // SPRINT-38: Scope the total to active registrations.
          _sum: { ticketCount: true }, // SPRINT-38: Honor multi-ticket registrations.
        }), // SPRINT-38: Complete registered ticket aggregation.
        this.prisma.eventAttendee.aggregate({
          // SPRINT-38: Sum ticket quantities already admitted.
          where: { ...activeWhere, checkedInAt: { not: null } },
          _sum: { ticketCount: true }, // SPRINT-38: Count the checked-in party sizes.
        }), // SPRINT-38: Complete admitted ticket aggregation.
        this.prisma.eventAttendee.count({ where: listWhere }), // SPRINT-38: Count rows matching the list filter.
        this.prisma.eventAttendee.findMany({
          // SPRINT-38: Load the requested status page.
          where: listWhere, // SPRINT-38: Apply active/event/filter scope.
          orderBy: { joinedAt: 'desc' }, // SPRINT-38: Show newest registrations first.
          skip: (page - 1) * limit, // SPRINT-38: Apply page offset.
          take: limit, // SPRINT-38: Apply page size.
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
                email: true,
              },
            },
          }, // SPRINT-38: Load scanner attendee identity.
        }), // SPRINT-38: Complete status page query.
      ]); // SPRINT-38: Complete dashboard transaction.
    const totalRegistered = totalAggregate._sum.ticketCount ?? 0; // SPRINT-38: Normalize an empty event to zero registered people.
    const checkedIn = checkedInAggregate._sum.ticketCount ?? 0; // SPRINT-38: Normalize no admissions to zero people.
    const data = await Promise.all(
      registrations.map(async (registration) => ({
        // SPRINT-38: Format each active registration.
        ...(await this.formatCheckInAttendee(registration)), // SPRINT-38: Reuse scanner identity shape.
        registeredAt: registration.joinedAt, // SPRINT-38: Include registration time.
        checkedInAt: registration.checkedInAt, // SPRINT-38: Include nullable admission time.
        checkedIn: registration.checkedInAt !== null, // SPRINT-38: Provide convenient boolean state.
      })),
    ); // SPRINT-38: Complete status list formatting.
    return {
      // SPRINT-38: Return totals and standard pagination.
      totalRegistered, // SPRINT-38: Number of people represented by active ticket quantities.
      checkedIn, // SPRINT-38: Number of people represented by redeemed ticket quantities.
      remaining: totalRegistered - checkedIn, // SPRINT-38: Number of registered people awaiting admission.
      data, // SPRINT-38: Filtered registration page.
      meta: createPaginationMeta(page, limit, filteredTotal), // SPRINT-38: Match standard pagination envelope.
    }; // SPRINT-38: End check-in status response.
  } // SPRINT-38: End organiser check-in status.
}
