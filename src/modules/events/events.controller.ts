import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode, // SPRINT-38: Return ticket outcomes as explicit HTTP 200 results.
  HttpStatus, // SPRINT-38: Use the Nest success status constant.
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
import { Throttle } from '@nestjs/throttler'; // SPRINT-38: Apply a door-appropriate route-specific scanner limit.
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsQueryDto } from './dto/events-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventReportReasonDto } from './dto/report-reason.dto';
import { AttendEventDto } from './dto/attend-event.dto';
import { CreateEventReviewDto } from './dto/create-event-review.dto'; // SPRINT-38: Validate review creation.
import { UpdateEventReviewDto } from './dto/update-event-review.dto'; // SPRINT-38: Validate review edits.
import { CheckInTicketDto } from './dto/check-in-ticket.dto'; // SPRINT-38: Validate scanned ticket requests.
import { EventCheckInStatusDto } from './dto/event-checkin-status.dto'; // SPRINT-38: Validate check-in status pagination and filtering.

const EVENT_UPLOAD_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('stories')
  @ApiOperation({ summary: 'Lightweight events for feed story strip' })
  @ApiQuery({ name: 'city', required: false })
  getStories(@CurrentUser('id') userId: string, @Query('city') city?: string) {
    return this.eventsService.getStoryEvents(userId, city);
  }

  @Get('me')
  @ApiOperation({ summary: 'Events created by current user' })
  getMyEvents(@CurrentUser('id') userId: string) {
    return this.eventsService.getMyEvents(userId);
  }

  @Get('registered')
  @ApiOperation({ summary: 'Events the user is attending' })
  getRegistered(@CurrentUser('id') userId: string) {
    return this.eventsService.getRegisteredEvents(userId);
  }

  @Get('saved')
  @ApiOperation({ summary: "Get current user's saved events (paginated)" })
  @ApiResponse({ status: 200, description: 'Paginated saved events' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getSaved(@CurrentUser('id') userId: string, @Query() query: PaginationDto) {
    return this.eventsService.getSavedEvents(userId, query);
  }

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: 'List events with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'format', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'upcoming', required: false })
  @ApiResponse({ status: 200, description: 'Paginated events' })
  async getEvents(
    @CurrentUser('id') userId: string | undefined,
    @Query() query: EventsQueryDto,
  ) {
    return this.eventsService.getEvents(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create event' })
  @ApiResponse({ status: 201, description: 'Event created' })
  async createEvent(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventsService.createEvent(userId, dto);
  }

  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('images', 6, {
      limits: { fileSize: EVENT_UPLOAD_MAX_SIZE },
    }),
  )
  @ApiOperation({ summary: 'Upload event cover images (host only)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Images uploaded' })
  async uploadEventImages(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const list = files ?? [];
    if (list.length === 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'No files uploaded',
      });
    }
    return this.eventsService.uploadEventImages(userId, id, list);
  }

  @Get(':id/reviews') // SPRINT-38: List reviews under the event identifier.
  @OptionalAuth()
  @ApiOperation({ summary: 'Get paginated reviews for an event' }) // SPRINT-38: Document review listing.
  @ApiQuery({ name: 'page', required: false }) // SPRINT-38: Document standard page number.
  @ApiQuery({ name: 'limit', required: false }) // SPRINT-38: Document standard page size.
  @ApiResponse({ status: 200, description: 'Paginated event reviews' }) // SPRINT-38: Document list success.
  @ApiResponse({ status: 404, description: 'Event not found' }) // SPRINT-38: Document missing event.
  getEventReviews(
    // SPRINT-38: Handle event review listing.
    @Param('id') eventId: string, // SPRINT-38: Read parent event identifier.
    @Query() query: PaginationDto, // SPRINT-38: Read validated pagination.
  ) {
    // SPRINT-38: Delegate review listing.
    return this.eventsService.getEventReviews(eventId, query); // SPRINT-38: Return restaurant-shaped pagination.
  } // SPRINT-38: End review list route.

  @Post(':id/reviews') // SPRINT-38: Create a review under the event identifier.
  @ApiOperation({ summary: 'Submit an attendee review after an event' }) // SPRINT-38: Document review creation.
  @ApiResponse({ status: 201, description: 'Event review created' }) // SPRINT-38: Document create success.
  @ApiResponse({ status: 400, description: 'Event has not taken place' }) // SPRINT-38: Document timing rejection.
  @ApiResponse({
    status: 403,
    description: 'Not an attendee or organiser self-review',
  }) // SPRINT-38: Document eligibility rejection.
  @ApiResponse({
    status: 409,
    description: 'Attendee already reviewed this event',
  }) // SPRINT-38: Document database-backed duplicate rejection.
  createEventReview(
    // SPRINT-38: Handle attendee review creation.
    @CurrentUser('id') userId: string, // SPRINT-38: Read acting attendee.
    @Param('id') eventId: string, // SPRINT-38: Read reviewed event.
    @Body() dto: CreateEventReviewDto, // SPRINT-38: Read validated rating and content.
  ) {
    // SPRINT-38: Delegate review creation.
    return this.eventsService.createEventReview(userId, eventId, dto); // SPRINT-38: Return the created restaurant-shaped review.
  } // SPRINT-38: End review creation route.

  @Patch(':id/reviews/:reviewId') // SPRINT-38: Edit a specific review beneath its event.
  @ApiOperation({ summary: 'Edit own event review' }) // SPRINT-38: Document author-only editing.
  @ApiResponse({ status: 200, description: 'Event review updated' }) // SPRINT-38: Document edit success.
  @ApiResponse({ status: 403, description: 'Only the review author may edit' }) // SPRINT-38: Document edit authorization.
  updateEventReview(
    // SPRINT-38: Handle review editing.
    @CurrentUser('id') userId: string, // SPRINT-38: Read acting author.
    @Param('id') eventId: string, // SPRINT-38: Read parent event.
    @Param('reviewId') reviewId: string, // SPRINT-38: Read target review.
    @Body() dto: UpdateEventReviewDto, // SPRINT-38: Read validated optional replacements.
  ) {
    // SPRINT-38: Delegate review editing.
    return this.eventsService.updateEventReview(userId, eventId, reviewId, dto); // SPRINT-38: Return updated review.
  } // SPRINT-38: End review update route.

  @Delete(':id/reviews/:reviewId') // SPRINT-38: Delete a specific review beneath its event.
  @ApiOperation({
    summary: 'Delete an event review as author or event organiser',
  }) // SPRINT-38: Document intentional organiser moderation divergence.
  @ApiResponse({ status: 200, description: 'Event review deleted' }) // SPRINT-38: Document deletion success.
  @ApiResponse({
    status: 403,
    description: 'Not review author or event organiser',
  }) // SPRINT-38: Document deletion authorization.
  deleteEventReview(
    // SPRINT-38: Handle review deletion.
    @CurrentUser('id') userId: string, // SPRINT-38: Read acting user.
    @Param('id') eventId: string, // SPRINT-38: Read parent event.
    @Param('reviewId') reviewId: string, // SPRINT-38: Read target review.
  ) {
    // SPRINT-38: Delegate review deletion.
    return this.eventsService.deleteEventReview(userId, eventId, reviewId); // SPRINT-38: Return restaurant-equivalent deletion result.
  } // SPRINT-38: End review delete route.

  @Post(':id/check-in') // SPRINT-38: Redeem one scanned ticket beneath its event.
  @HttpCode(HttpStatus.OK) // SPRINT-38: Make admission and rejection ticket outcomes HTTP-success results.
  @Throttle({ default: { ttl: 60000, limit: 120 } }) // SPRINT-38: Allow two scans/second while bounding automated endpoint abuse.
  @ApiOperation({
    // SPRINT-38: Document the complete scanner result contract.
    summary: 'Validate and check in a scanned event ticket (organiser only)', // SPRINT-38: Describe host-only mutation.
    description:
      'Returns reasonCode ADMITTED, INVALID_TICKET, WRONG_EVENT, ALREADY_CHECKED_IN, or REGISTRATION_CANCELLED with HTTP 200 for ticket outcomes.', // SPRINT-38: Make result-versus-exception behavior explicit.
  }) // SPRINT-38: Complete check-in operation documentation.
  @ApiResponse({
    status: 200,
    description: 'Structured admission or ticket rejection result',
  }) // SPRINT-38: Document all ticket outcomes.
  @ApiResponse({
    status: 403,
    description: 'Only the organiser may check attendees in',
  }) // SPRINT-38: Document endpoint misuse.
  checkInTicket(
    // SPRINT-38: Handle ticket redemption.
    @CurrentUser('id') userId: string, // SPRINT-38: Read checking organiser.
    @Param('id') eventId: string, // SPRINT-38: Read door event.
    @Body() dto: CheckInTicketDto, // SPRINT-38: Read the QR attendeeId.
  ) {
    // SPRINT-38: Delegate one-time validation.
    return this.eventsService.checkInTicket(userId, eventId, dto.ticketId); // SPRINT-38: Return a structured scanner result.
  } // SPRINT-38: End check-in route.

  @Get(':id/check-in') // SPRINT-38: Expose event check-in progress beneath the event.
  @ApiOperation({ summary: 'Get organiser check-in totals and registrations' }) // SPRINT-38: Document the scanner dashboard.
  @ApiQuery({ name: 'page', required: false }) // SPRINT-38: Document status page number.
  @ApiQuery({ name: 'limit', required: false }) // SPRINT-38: Document status page size.
  @ApiQuery({
    name: 'filter',
    required: false,
    enum: ['checked_in', 'remaining'],
  }) // SPRINT-38: Document optional check-in filter.
  @ApiResponse({
    status: 200,
    description: 'Check-in totals and paginated active registrations',
  }) // SPRINT-38: Document dashboard success.
  getEventCheckInStatus(
    // SPRINT-38: Handle check-in dashboard query.
    @CurrentUser('id') userId: string, // SPRINT-38: Read acting organiser.
    @Param('id') eventId: string, // SPRINT-38: Read dashboard event.
    @Query() query: EventCheckInStatusDto, // SPRINT-38: Read validated filtering and pagination.
  ) {
    // SPRINT-38: Delegate status query.
    return this.eventsService.getEventCheckInStatus(userId, eventId, query); // SPRINT-38: Return totals and registrations.
  } // SPRINT-38: End check-in status route.

  @Get(':id')
  @OptionalAuth()
  @ApiOperation({ summary: 'Get event by ID' })
  async getEventById(
    @CurrentUser('id') userId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.eventsService.getEventById(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update own event' })
  async updateEvent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.updateEvent(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete own event' })
  async deleteEvent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.eventsService.deleteEvent(userId, id);
  }

  @Post(':id/attend')
  @ApiOperation({ summary: 'RSVP to event' })
  async attendEvent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: AttendEventDto,
  ) {
    return this.eventsService.attendEvent(userId, id, dto ?? {});
  }

  @Delete(':id/attend')
  @ApiOperation({ summary: 'Cancel RSVP' })
  async cancelAttendance(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.eventsService.cancelAttendance(userId, id);
  }

  @Post(':id/register')
  @ApiOperation({ summary: 'Register for event (alias of attend; mobile)' })
  async register(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: AttendEventDto,
  ) {
    return this.eventsService.registerForEvent(userId, id, dto ?? {});
  }

  @Delete(':id/register')
  @ApiOperation({ summary: 'Cancel registration (alias of cancel attend)' })
  async unregister(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.eventsService.cancelRegistration(userId, id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle saved / bookmark' })
  async toggleSave(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.eventsService.toggleSaveEvent(userId, id);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Report an event' })
  async report(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: EventReportReasonDto,
  ) {
    return this.eventsService.reportEvent(userId, id, dto.reason);
  }

  @Get(':id/attendees')
  @ApiOperation({ summary: 'List attendees (host only)' })
  getAttendees(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.eventsService.getEventAttendees(userId, id);
  }

  @Get(':id/ticket')
  @ApiOperation({ summary: 'Current user ticket stub (after registration)' })
  getTicket(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.eventsService.getMyTicket(userId, id);
  }
}
