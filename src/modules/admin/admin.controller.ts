import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe, // SPRINT-35: validate badge types on the audited revoke route
  Patch,
  Post,
  Query,
  Req, // SPRINT-35: read the acting session ID for safe session termination
  UseGuards,
  UseInterceptors, // SPRINT-52
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import { WarnUserDto } from './dto/warn-user.dto';
import { GrantUserBadgeDto } from './dto/grant-user-badge.dto';
import { AdminContentQueryDto } from './dto/admin-content-query.dto';
import { ModerateContentDto } from './dto/moderate-content.dto';
import { ReviewBadgeApplicationDto } from './dto/review-badge-application.dto';
import { ApproveBadgeApplicationDto } from './dto/approve-badge-application.dto';
import { RejectBadgeApplicationDto } from './dto/reject-badge-application.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CreateAdminPollDto } from './dto/create-admin-poll.dto';
import { ModerateActionDto } from './dto/moderate-action.dto';
import { ReplyToTicketDto } from './dto/reply-to-ticket.dto';
import { SendBroadcastDto } from './dto/send-broadcast.dto';
import { AdminSessionsQueryDto } from './dto/admin-sessions-query.dto'; // SPRINT-35: validate session list pagination and user filter
import type { Request } from 'express'; // SPRINT-35: type the current express-session identifier
import { BadgeType } from '@prisma/client'; // SPRINT-35: constrain badge revocation to persisted badge types
import { AdminReportsQueryDto } from './dto/admin-reports-query.dto'; // SPRINT-51
import { ReportActionDto } from './dto/report-action.dto'; // SPRINT-51
import { PrivacyRequestReasonDto } from './dto/privacy-request-reason.dto'; // SPRINT-55
import { AdminAuditInterceptor } from './admin-audit.interceptor'; // SPRINT-52

@ApiTags('Admin')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('ADMIN')
@UseInterceptors(AdminAuditInterceptor) // SPRINT-52: audit successful mutating admin requests
@ApiResponse({ status: 403, description: 'Admin role required' })
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminService.getUsers(query);
  }

  @Get('analytics')
  getAnalytics() {
    return this.adminService.getAnalytics();
  }

  // SPRINT-52: general admin activity trail — before parameterized routes that could collide
  @Get('audit-log')
  @ApiOperation({ summary: 'Paginated admin audit log (newest first)' })
  getAuditLog(
    @CurrentUser('id') adminUserId: string,
    @Query() query: PaginationDto,
  ) {
    return this.adminService.getAuditLog(
      adminUserId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  // SPRINT-53: admin chat read access
  @Get('chat/conversations/:id')
  @ApiOperation({
    summary: 'View any conversation (bypasses membership check)',
  })
  getAdminChatConversation(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.getAdminChatConversation(adminUserId, id);
  }

  @Get('chat/conversations/:id/messages')
  @ApiOperation({
    summary: 'List messages for any conversation (cursor pagination)',
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getAdminChatMessages(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum =
      limit != null
        ? Math.min(Math.max(1, parseInt(String(limit), 10)), 100)
        : undefined;
    return this.adminService.getAdminChatMessages(
      adminUserId,
      id,
      cursor,
      limitNum,
    );
  }

  @Delete('chat/messages/:id')
  @ApiOperation({ summary: 'Hard-delete a message (admin)' })
  deleteAdminChatMessage(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteAdminChatMessage(adminUserId, id);
  }

  @Get('reports')
  getReports(@Query() query: AdminReportsQueryDto) {
    // SPRINT-51: pass filter query through to the service
    return this.adminService.getReports(query);
  }

  // SPRINT-51: POST /admin/reports/:id/action — must be registered before other reports/:id routes that share the param
  @Post('reports/:id/action')
  @ApiOperation({
    summary:
      'Resolve a non-listing report via warn, suspend, or remove-content',
  })
  actionReport(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: ReportActionDto,
  ) {
    return this.adminService.actionReport(adminUserId, id, dto);
  }

  @Get('feed')
  getFeedPosts(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('published') published?: string,
  ) {
    return this.adminService.getFeedPosts({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      category: category as any,
      published: published === undefined ? undefined : published === 'true',
    });
  }

  @Get('feed/trending')
  getTrendingPosts(@Query('limit') limit?: string) {
    return this.adminService.getTrendingPosts(limit ? Number(limit) : 20);
  }

  @Patch('feed/:id/moderate')
  moderateFeedPost(
    // SPRINT-35: pass the authenticated actor into defence-in-depth authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target feed post identifier
    @Body() dto: ModerateActionDto, // SPRINT-35: retain validated moderation action
  ) {
    // SPRINT-35: complete defended feed moderation handler
    return this.adminService.moderateFeedPost(
      // SPRINT-35: invoke service with explicit actor context
      adminUserId, // SPRINT-35: authorize the acting administrator in the service
      id, // SPRINT-35: identify the target post
      dto.action as any, // SPRINT-35: preserve existing moderation action mapping
    ); // SPRINT-35: complete defended service call
  }

  @Get('polls')
  getPolls(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.adminService.getAdminPolls({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('polls')
  createPoll(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAdminPollDto,
  ) {
    return this.adminService.createAdminPoll(userId, dto);
  }

  @Patch('polls/:id/toggle')
  togglePoll(
    // SPRINT-35: pass actor context for independent poll authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target poll identifier
  ) {
    // SPRINT-35: complete defended toggle handler
    return this.adminService.toggleAdminPoll(adminUserId, id); // SPRINT-35: authorize before toggling poll state
  }

  @Delete('polls/:id')
  deletePoll(
    // SPRINT-35: pass actor context for independent destructive authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target poll identifier
  ) {
    // SPRINT-35: complete defended delete handler
    return this.adminService.deleteAdminPoll(adminUserId, id); // SPRINT-35: authorize before deleting the poll
  }

  @Get('community/questions')
  getCommunityQuestions(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.adminService.getCommunityQuestions({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      category,
    });
  }

  @Get('community/news')
  getCommunityNews(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.adminService.getCommunityNewsPosts({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      category: category as any,
    });
  }

  @Delete('community/questions/:id')
  moderateCommunityQuestion(
    // SPRINT-35: pass actor context for independent question-moderation authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target question identifier
  ) {
    // SPRINT-35: complete defended question moderation handler
    return this.adminService.moderateCommunityQuestion(adminUserId, id); // SPRINT-35: authorize before deleting the question
  }

  @Get('roommates')
  getRoommates(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getRoommateProfiles({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
    });
  }

  @Patch('roommates/:id/moderate')
  moderateRoommate(
    // SPRINT-35: pass actor context for independent roommate-moderation authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target user identifier
    @Body() dto: ModerateActionDto, // SPRINT-35: retain validated moderation action
  ) {
    // SPRINT-35: complete defended roommate moderation handler
    return this.adminService.suspendRoommateProfile(
      adminUserId, // SPRINT-35: authorize the acting administrator in the service
      id,
      dto.action as 'suspend' | 'delete',
    );
  }

  @Get('restaurants')
  getRestaurants(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('isVerified') isVerified?: string,
  ) {
    return this.adminService.getAdminRestaurants({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      isVerified: isVerified === undefined ? undefined : isVerified === 'true',
    });
  }

  @Patch('restaurants/:id/moderate')
  moderateRestaurant(
    // SPRINT-35: pass actor context for independent restaurant authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target restaurant identifier
    @Body() dto: ModerateActionDto, // SPRINT-35: retain validated moderation action
  ) {
    // SPRINT-35: complete defended restaurant moderation handler
    return this.adminService.moderateRestaurant(
      // SPRINT-35: invoke service with actor context
      adminUserId, // SPRINT-35: authorize the acting administrator
      id, // SPRINT-35: identify target restaurant
      dto.action as any, // SPRINT-35: preserve existing action mapping
    ); // SPRINT-35: complete defended restaurant moderation call
  }

  @Get('listings')
  getListings(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('propertyType') propertyType?: string,
  ) {
    return this.adminService.getAdminListings({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      status: status as any,
      propertyType: propertyType as any,
    });
  }

  @Patch('listings/:id/moderate')
  moderateListing(
    // SPRINT-35: pass actor context for independent listing authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target listing identifier
    @Body() dto: ModerateActionDto, // SPRINT-35: retain validated moderation action
  ) {
    // SPRINT-35: complete defended listing moderation handler
    return this.adminService.moderateListing(
      // SPRINT-35: invoke service with actor context
      adminUserId, // SPRINT-35: authorize the acting administrator
      id, // SPRINT-35: identify target listing
      dto.action as any, // SPRINT-35: preserve existing action mapping
      dto.reason, // SPRINT-54: optional rejection reason for listings only
    ); // SPRINT-35: complete defended listing moderation call
  }

  // SPRINT-54: paginated stories for admin review
  @Get('stories')
  getStories(
    @CurrentUser('id') adminUserId: string, // SPRINT-54: defence-in-depth actor
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getAdminStories(adminUserId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // SPRINT-54: hard-delete story mirroring expiry cron file cleanup
  @Delete('stories/:id')
  deleteStory(
    @CurrentUser('id') adminUserId: string, // SPRINT-54: defence-in-depth actor
    @Param('id') id: string,
  ) {
    return this.adminService.adminDeleteStory(adminUserId, id);
  }

  @Get('areas')
  getAreas() {
    return this.adminService.getAreas();
  }

  @Get('notifications/broadcasts')
  getBroadcastHistory(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getBroadcastHistory({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('notifications/broadcast')
  sendBroadcast(
    @CurrentUser('id') userId: string,
    @Body() dto: SendBroadcastDto,
  ) {
    return this.adminService.sendBroadcast(userId, dto);
  }

  @Get('support')
  getSupportTickets(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.getSupportTickets({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status: status as any,
    });
  }

  @Patch('support/:id/reply')
  replyToTicket(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ReplyToTicketDto,
  ) {
    return this.adminService.replyToSupportTicket(userId, id, dto);
  }

  @Get('sessions') // SPRINT-35: expose real Redis-backed authenticated sessions
  @ApiOperation({ summary: 'List active authenticated sessions' }) // SPRINT-35: document session monitoring purpose
  @ApiResponse({ status: 200, description: 'Paginated active sessions.' }) // SPRINT-35: document successful list response
  @ApiResponse({ status: 403, description: 'Admin role required' }) // SPRINT-35: document role enforcement
  getActiveSessions(@Query() query: AdminSessionsQueryDto) {
    // SPRINT-35: accept page, pageSize, and optional userId
    return this.adminService.getActiveSessions(query); // SPRINT-35: enumerate Redis sessions and batch-resolve users
  } // SPRINT-35: complete active-session list route

  @Delete('sessions/session/:sessionId') // SPRINT-35: use a distinct static segment to avoid user-route collision
  @ApiOperation({ summary: 'Terminate one active session' }) // SPRINT-35: document targeted session revocation
  @ApiResponse({ status: 200, description: 'Session terminated.' }) // SPRINT-35: document successful revocation
  @ApiResponse({
    status: 400,
    description: 'Cannot terminate current admin session',
  }) // SPRINT-35: document self-revocation protection
  @ApiResponse({ status: 403, description: 'Admin role required' }) // SPRINT-35: document role enforcement
  @ApiResponse({ status: 404, description: 'Session not found or expired' }) // SPRINT-35: document stale session identifier handling
  terminateSession(
    // SPRINT-35: pass actor, current session, and target session to the service
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Req() req: Request, // SPRINT-35: obtain the raw current express-session identifier
    @Param('sessionId') sessionId: string, // SPRINT-35: accept the prefix-free target session identifier
  ) {
    // SPRINT-35: complete targeted session route signature
    return this.adminService.terminateSession(
      // SPRINT-35: invoke defence-in-depth revocation
      adminUserId, // SPRINT-35: authorize the acting administrator in the service
      req.sessionID, // SPRINT-35: protect the current admin session from termination
      sessionId, // SPRINT-35: identify the target Redis session
    ); // SPRINT-35: complete targeted session service call
  } // SPRINT-35: finish targeted session route

  @Delete('sessions/user/:userId') // SPRINT-35: use a distinct static segment for bulk user revocation
  @ApiOperation({ summary: 'Terminate all active sessions for one user' }) // SPRINT-35: document compromised-account response action
  @ApiResponse({ status: 200, description: 'Matching sessions terminated.' }) // SPRINT-35: document bulk revocation response
  @ApiResponse({ status: 403, description: 'Admin role required' }) // SPRINT-35: document role enforcement
  terminateUserSessions(
    // SPRINT-35: pass actor, current session, and target user to the service
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Req() req: Request, // SPRINT-35: obtain current session for exclusion
    @Param('userId') userId: string, // SPRINT-35: identify the compromised target account
  ) {
    // SPRINT-35: complete bulk session route signature
    return this.adminService.terminateUserSessions(
      // SPRINT-35: invoke bounded Redis bulk revocation
      adminUserId, // SPRINT-35: authorize the acting administrator in the service
      req.sessionID, // SPRINT-35: preserve the acting administrator's current session
      userId, // SPRINT-35: filter sessions to the target user
    ); // SPRINT-35: complete bulk termination service call
  } // SPRINT-35: finish bulk session route

  @Patch('reports/:id/dismiss')
  dismissReport(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.dismissReport(adminUserId, id);
  }

  @Delete('reports/:id/listing')
  resolveReportAndDeleteListing(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.resolveReportAndDeleteListing(adminUserId, id);
  }

  @Get('settings')
  getPlatformSettings() {
    return this.adminService.getPlatformSettings();
  }

  @Patch('settings')
  updatePlatformSettings(
    // SPRINT-35: pass actor context for independent settings authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Body() dto: UpdatePlatformSettingsDto, // SPRINT-35: retain validated platform settings
  ) {
    // SPRINT-35: complete defended platform-settings handler
    return this.adminService.updatePlatformSettings(adminUserId, dto); // SPRINT-35: authorize before updating platform settings
  }

  @Get('content')
  getContent(@Query() query: AdminContentQueryDto) {
    return this.adminService.getContent(query);
  }

  @Get('badges/applications')
  getBadgeApplications(@Query() query: PaginationDto) {
    return this.adminService.getBadgeApplications(query);
  }

  @Patch('badges/applications/:id/approve')
  @ApiOperation({ summary: 'Approve badge application' })
  @ApiResponse({ status: 200, description: 'Application approved.' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 400, description: 'Already reviewed' })
  approveBadgeApplication(
    @CurrentUser('id') adminUserId: string,
    @Param('id') applicationId: string,
    @Body() dto: ApproveBadgeApplicationDto,
  ) {
    return this.adminService.reviewBadgeApplication(
      adminUserId,
      applicationId,
      {
        status: 'APPROVED',
        adminNotes: dto.adminNotes,
      },
    );
  }

  @Patch('badges/applications/:id/reject')
  @ApiOperation({ summary: 'Reject badge application' })
  @ApiResponse({ status: 200, description: 'Application rejected.' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  @ApiResponse({ status: 400, description: 'Already reviewed' })
  rejectBadgeApplication(
    @CurrentUser('id') adminUserId: string,
    @Param('id') applicationId: string,
    @Body() dto: RejectBadgeApplicationDto,
  ) {
    return this.adminService.reviewBadgeApplication(
      adminUserId,
      applicationId,
      {
        status: 'REJECTED',
        adminNotes: dto.adminNotes,
      },
    );
  }

  @Patch('badges/applications/:id')
  reviewBadgeApplication(
    @CurrentUser('id') adminUserId: string,
    @Param('id') applicationId: string,
    @Body() dto: ReviewBadgeApplicationDto,
  ) {
    return this.adminService.reviewBadgeApplication(
      adminUserId,
      applicationId,
      dto,
    );
  }

  @Get('users/:id/warnings') // SPRINT-52: before GET users/:id
  @ApiOperation({
    summary: "Paginated warning history for a user's safety case file",
  })
  getUserWarnings(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Query() query: PaginationDto,
  ) {
    return this.adminService.getUserWarnings(
      adminUserId,
      id,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('users/:id/ban-history') // SPRINT-52: before GET users/:id
  @ApiOperation({
    summary: "Paginated ban/restoration history for a user's safety case file",
  })
  getUserBanHistory(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Query() query: PaginationDto,
  ) {
    return this.adminService.getUserBanHistory(
      adminUserId,
      id,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('users/:id')
  getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id')
  updateUser(
    // SPRINT-35: pass actor context for independent user-management authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target user identifier
    @Body() dto: UpdateUserAdminDto, // SPRINT-35: retain validated user changes
  ) {
    // SPRINT-35: complete defended user-update handler
    return this.adminService.updateUser(adminUserId, id, dto); // SPRINT-35: authorize before changing the user
  }

  @Post('users/:id/warn')
  warnUser(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: WarnUserDto,
  ) {
    return this.adminService.warnUser(adminUserId, id, dto.message);
  }

  // SPRINT-55: immediate GDPR-style data export
  @Post('users/:id/data-export')
  @ApiOperation({ summary: 'Export all cascading-delete-scoped user data' })
  createDataExport(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: PrivacyRequestReasonDto,
  ) {
    return this.adminService.createDataExport(adminUserId, id, dto?.reason);
  }

  // SPRINT-55: start Sprint 10 soft-delete as admin-initiated erasure
  @Post('users/:id/erasure-request')
  @ApiOperation({
    summary: 'Start admin-initiated account erasure (15-day window)',
  })
  createErasureRequest(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: PrivacyRequestReasonDto,
  ) {
    return this.adminService.createErasureRequest(adminUserId, id, dto?.reason);
  }

  // SPRINT-55: compliance log list
  @Get('privacy-requests')
  @ApiOperation({ summary: 'Paginated privacy request compliance log' })
  getPrivacyRequests(
    @CurrentUser('id') adminUserId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getPrivacyRequests(adminUserId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // SPRINT-55: admin-only export download (not public file route)
  @Get('privacy-requests/:id/export-download')
  @ApiOperation({
    summary: 'Download a completed data-export payload (admin only)',
  })
  downloadDataExport(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.downloadDataExport(adminUserId, id);
  }

  // SPRINT-55: compliance sign-off only
  @Patch('privacy-requests/:id/approve')
  @ApiOperation({ summary: 'Approve pending erasure (compliance record only)' })
  approvePrivacyRequest(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.approvePrivacyRequest(adminUserId, id);
  }

  // SPRINT-55: cancel pending erasure soft-delete
  @Patch('privacy-requests/:id/reject')
  @ApiOperation({ summary: 'Reject pending erasure and restore the user' })
  rejectPrivacyRequest(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
  ) {
    return this.adminService.rejectPrivacyRequest(adminUserId, id);
  }

  @Post('users/:id/grant-badge')
  grantUserBadge(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: GrantUserBadgeDto,
  ) {
    return this.adminService.grantUserBadge(adminUserId, id, dto.badgeType);
  }

  @Delete('users/:id/revoke-badge/:type') // SPRINT-35: implement the audited mobile badge-revocation contract
  @ApiOperation({ summary: 'Revoke a badge from a user' }) // SPRINT-35: document the destructive trust action
  @ApiResponse({ status: 200, description: 'Badge revoked.' }) // SPRINT-35: document successful revocation
  @ApiResponse({ status: 403, description: 'Admin role required' }) // SPRINT-35: document role enforcement
  @ApiResponse({ status: 404, description: 'User badge not found' }) // SPRINT-35: document absent badge handling
  revokeUserBadge(
    // SPRINT-35: pass actor, target user, and validated badge type
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: identify the target user
    @Param('type', new ParseEnumPipe(BadgeType)) badgeType: BadgeType, // SPRINT-35: reject unsupported badge names
  ) {
    // SPRINT-35: complete revoke-badge handler
    return this.adminService.revokeUserBadge(adminUserId, id, badgeType); // SPRINT-35: authorize and remove the granted badge
  } // SPRINT-35: finish revoke-badge route

  @Delete('users/:id')
  deleteUser(
    // SPRINT-35: pass actor context for independent permanent-deletion authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target user identifier
  ) {
    // SPRINT-35: complete defended user-delete handler
    return this.adminService.deleteUser(adminUserId, id); // SPRINT-35: authorize before permanent deletion
  }

  @Patch('content/:id')
  moderateContent(
    // SPRINT-35: pass actor context for independent generic moderation authorization
    @CurrentUser('id') adminUserId: string, // SPRINT-35: resolve acting administrator from AuthGuard
    @Param('id') id: string, // SPRINT-35: retain target content identifier
    @Body() dto: ModerateContentDto, // SPRINT-35: retain validated content action
  ) {
    // SPRINT-35: complete defended content-moderation handler
    return this.adminService.moderateContent(adminUserId, id, dto); // SPRINT-35: authorize before mutating generic content
  }
}
