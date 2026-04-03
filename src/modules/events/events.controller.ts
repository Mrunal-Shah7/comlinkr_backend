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
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsQueryDto } from './dto/events-query.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { ReportReasonDto } from './dto/report-reason.dto';

const EVENT_UPLOAD_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('Events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('stories')
  @ApiOperation({ summary: 'Lightweight events for feed story strip' })
  @ApiQuery({ name: 'city', required: false })
  getStories(
    @CurrentUser('id') userId: string,
    @Query('city') city?: string,
  ) {
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
  @ApiOperation({ summary: 'Saved / bookmarked events' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getSaved(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.eventsService.getSavedEvents(userId, query);
  }

  @Get()
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
    @CurrentUser('id') userId: string,
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

  @Get(':id')
  @ApiOperation({ summary: 'Get event by ID' })
  async getEventById(
    @CurrentUser('id') userId: string,
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
  ) {
    return this.eventsService.attendEvent(userId, id);
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
  ) {
    return this.eventsService.registerForEvent(userId, id);
  }

  @Delete(':id/register')
  @ApiOperation({ summary: 'Cancel registration (alias of cancel attend)' })
  async unregister(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.eventsService.cancelRegistration(userId, id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle saved / bookmark' })
  async toggleSave(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.eventsService.toggleSaveEvent(userId, id);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Report an event' })
  async report(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ReportReasonDto,
  ) {
    return this.eventsService.reportEvent(userId, id, dto.reason);
  }

  @Get(':id/attendees')
  @ApiOperation({ summary: 'List attendees (host only)' })
  getAttendees(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.eventsService.getEventAttendees(userId, id);
  }

  @Get(':id/ticket')
  @ApiOperation({ summary: 'Current user ticket stub (after registration)' })
  getTicket(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.eventsService.getMyTicket(userId, id);
  }
}
