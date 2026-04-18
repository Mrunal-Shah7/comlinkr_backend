import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { AdminContentQueryDto } from './dto/admin-content-query.dto';
import { ModerateContentDto } from './dto/moderate-content.dto';
import { ReviewBadgeApplicationDto } from './dto/review-badge-application.dto';
import { ApproveBadgeApplicationDto } from './dto/approve-badge-application.dto';
import { RejectBadgeApplicationDto } from './dto/reject-badge-application.dto';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

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
  getReports() {
    return this.adminService.getReports();
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

  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Patch('content/:id')
  moderateContent(@Param('id') id: string, @Body() dto: ModerateContentDto) {
    return this.adminService.moderateContent(id, dto);
  }

}
