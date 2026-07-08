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
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RoommatesService } from './roommates.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { RoommatesQueryDto } from './dto/roommates-query.dto';
import { CreateRoommateListingDto } from './dto/create-roommate-listing.dto';
import { PatchRoommateListingDto } from './dto/patch-roommate-listing.dto';

@ApiTags('Roommates')
@Controller('roommates')
export class RoommatesController {
  constructor(private readonly roommatesService: RoommatesService) {}

  @Get('matches')
  @ApiOperation({
    summary: 'AI-style best-match list (same as search with sort=best_match)',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'city', required: false })
  getMatches(
    @CurrentUser('id') userId: string,
    @Query() query: RoommatesQueryDto,
  ) {
    return this.roommatesService.getMatches(userId, query);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get roommate search preferences' })
  getPreferences(@CurrentUser('id') userId: string) {
    return this.roommatesService.getPreferences(userId);
  }

  @Get('listing/me')
  @ApiOperation({ summary: 'Current user roommate listing (if isLooking)' })
  getMyListing(@CurrentUser('id') userId: string) {
    return this.roommatesService.getMyRoommateListing(userId);
  }

  @Post('listing')
  @ApiOperation({ summary: 'Publish roommate listing (sets isLooking)' })
  createListing(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRoommateListingDto,
  ) {
    return this.roommatesService.upsertMyListing(userId, dto);
  }

  @Patch('listing')
  @ApiOperation({ summary: 'Update roommate listing' })
  patchListing(
    @CurrentUser('id') userId: string,
    @Body() dto: PatchRoommateListingDto,
  ) {
    return this.roommatesService.patchMyListing(userId, dto);
  }

  @Delete('listing')
  @ApiOperation({ summary: 'Remove roommate listing (isLooking=false)' })
  deleteListing(@CurrentUser('id') userId: string) {
    return this.roommatesService.deleteMyListing(userId);
  }

  @Get()
  @ApiOperation({ summary: 'Search roommates with filters and sort' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['best_match', 'budget', 'move_in_soon', 'verified'],
  })
  @ApiQuery({ name: 'minBudget', required: false })
  @ApiQuery({ name: 'maxBudget', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiResponse({ status: 200, description: 'Paginated roommate cards' })
  async searchRoommates(
    @CurrentUser('id') userId: string,
    @Query() query: RoommatesQueryDto,
  ) {
    return this.roommatesService.searchRoommates(userId, query);
  }

  @Get('saved')
  @ApiOperation({ summary: "Get user's saved roommate profiles" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated saved roommate cards' })
  async getSavedRoommates(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.roommatesService.getSavedRoommates(userId, query);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update own roommate preferences' })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  async updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.roommatesService.updatePreferences(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get roommate profile with compatibility' })
  @ApiResponse({ status: 200, description: 'Roommate detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getRoommateProfile(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.roommatesService.getRoommateProfile(userId, id);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Toggle save/bookmark on a roommate profile' })
  @ApiResponse({ status: 200, description: 'Save state' })
  async toggleRoommateSave(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.roommatesService.toggleRoommateSave(userId, id);
  }

  @Post(':id/connect')
  @ApiOperation({ summary: 'Send connection request / start conversation' })
  @ApiResponse({
    status: 201,
    description: 'Connection request sent or existing conversation',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async sendConnectionRequest(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.roommatesService.sendConnectionRequest(userId, id);
  }

  @Post(':id/cancel') // SPRINT-33: sender withdraws an outgoing pending connection request
  @ApiOperation({ summary: 'Cancel outgoing roommate connection request' }) // SPRINT-33: Swagger summary for new endpoint
  @ApiResponse({ status: 200, description: 'Request cancelled' }) // SPRINT-33: success response doc
  @ApiResponse({ status: 400, description: 'No outgoing request to cancel' }) // SPRINT-33: invalid-state response doc
  @ApiResponse({ status: 404, description: 'User not found' }) // SPRINT-33: missing target response doc
  async cancelConnectionRequest( // SPRINT-33: controller handler for POST /:id/cancel
    @CurrentUser('id') userId: string, // SPRINT-33: authenticated sender id
    @Param('id') id: string, // SPRINT-33: target recipient id
  ) { // SPRINT-33
    return this.roommatesService.cancelConnectionRequest(userId, id); // SPRINT-33: delegate to service cancellation logic
  } // SPRINT-33

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept incoming roommate connection request from user :id',
  })
  @ApiResponse({ status: 200, description: 'Connection accepted' })
  @ApiResponse({ status: 400, description: 'No pending request' })
  async acceptConnection(
    @CurrentUser('id') userId: string,
    @Param('id') requesterId: string,
  ) {
    return this.roommatesService.acceptConnectionRequest(userId, requesterId);
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: 'Decline incoming roommate connection request from user :id',
  })
  @ApiResponse({ status: 200, description: 'Request declined' })
  async declineConnection(
    @CurrentUser('id') userId: string,
    @Param('id') requesterId: string,
  ) {
    return this.roommatesService.declineConnectionRequest(userId, requesterId);
  }
}
