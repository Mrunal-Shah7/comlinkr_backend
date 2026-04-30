import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
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

@ApiTags('Admin')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('ADMIN')
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

  @Get('reports')
  getReports(@Query() query: PaginationDto) {
    return this.adminService.getReports(query.page ?? 1, query.limit ?? 20);
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
  moderateFeedPost(@Param('id') id: string, @Body() dto: ModerateActionDto) {
    return this.adminService.moderateFeedPost(id, dto.action as any);
  }

  @Get('polls')
  getPolls(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.adminService.getAdminPolls({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('polls')
  createPoll(@CurrentUser('id') userId: string, @Body() dto: CreateAdminPollDto) {
    return this.adminService.createAdminPoll(userId, dto);
  }

  @Patch('polls/:id/toggle')
  togglePoll(@Param('id') id: string) {
    return this.adminService.toggleAdminPoll(id);
  }

  @Delete('polls/:id')
  deletePoll(@Param('id') id: string) {
    return this.adminService.deleteAdminPoll(id);
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
  moderateCommunityQuestion(@Param('id') id: string) {
    return this.adminService.moderateCommunityQuestion(id);
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
  moderateRoommate(@Param('id') id: string, @Body() dto: ModerateActionDto) {
    return this.adminService.suspendRoommateProfile(id, dto.action as 'suspend' | 'delete');
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
  moderateRestaurant(@Param('id') id: string, @Body() dto: ModerateActionDto) {
    return this.adminService.moderateRestaurant(id, dto.action as any);
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
  moderateListing(@Param('id') id: string, @Body() dto: ModerateActionDto) {
    return this.adminService.moderateListing(id, dto.action as any);
  }

  @Get('areas')
  getAreas() {
    return this.adminService.getAreas();
  }

  @Get('notifications/broadcasts')
  getBroadcastHistory(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.adminService.getBroadcastHistory({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('notifications/broadcast')
  sendBroadcast(@CurrentUser('id') userId: string, @Body() dto: SendBroadcastDto) {
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
  updatePlatformSettings(@Body() dto: UpdatePlatformSettingsDto) {
    return this.adminService.updatePlatformSettings(dto);
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
    return this.adminService.reviewBadgeApplication(adminUserId, applicationId, {
      status: 'APPROVED',
      adminNotes: dto.adminNotes,
    });
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
    return this.adminService.reviewBadgeApplication(adminUserId, applicationId, {
      status: 'REJECTED',
      adminNotes: dto.adminNotes,
    });
  }

  @Patch('badges/applications/:id')
  reviewBadgeApplication(
    @CurrentUser('id') adminUserId: string,
    @Param('id') applicationId: string,
    @Body() dto: ReviewBadgeApplicationDto,
  ) {
    return this.adminService.reviewBadgeApplication(adminUserId, applicationId, dto);
  }

  @Get('users/:id')
  getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserAdminDto) {
    return this.adminService.updateUser(id, dto);
  }

  @Post('users/:id/warn')
  warnUser(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: WarnUserDto,
  ) {
    return this.adminService.warnUser(adminUserId, id, dto.message);
  }

  @Post('users/:id/grant-badge')
  grantUserBadge(
    @CurrentUser('id') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: GrantUserBadgeDto,
  ) {
    return this.adminService.grantUserBadge(adminUserId, id, dto.badgeType);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Patch('content/:id')
  moderateContent(@Param('id') id: string, @Body() dto: ModerateContentDto) {
    return this.adminService.moderateContent(id, dto);
  }

}
