import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OnboardingService } from './onboarding.service';
import {
  SetLocationDto,
  SetVibesDto,
  SetInterestsDto,
  SetCommunitiesDto,
  AcceptAgreementDto,
} from './dto';

@ApiTags('Onboarding')
@Controller('onboarding')
@SkipOnboarding()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('vibes')
  @ApiOperation({ summary: 'List all vibes' })
  @ApiResponse({ status: 200, description: 'Array of 12 vibes' })
  async getVibes() {
    return this.onboardingService.getVibes();
  }

  @Get('interests')
  @ApiOperation({ summary: 'List all interests' })
  @ApiResponse({ status: 200, description: 'Array of 8 interests' })
  async getInterests() {
    return this.onboardingService.getInterests();
  }

  @Get('communities')
  @ApiOperation({ summary: 'List all communities by category' })
  @ApiResponse({ status: 200, description: 'Array of communities' })
  async getCommunities() {
    return this.onboardingService.getCommunities();
  }

  @Post('location')
  @ApiOperation({ summary: 'Step 1: Set user location' })
  @ApiBody({ type: SetLocationDto })
  @ApiResponse({ status: 200, description: 'Location saved' })
  async setLocation(
    @CurrentUser('id') userId: string,
    @Body() dto: SetLocationDto,
  ) {
    return this.onboardingService.setLocation(userId, dto);
  }

  @Post('vibes')
  @ApiOperation({ summary: 'Step 2: Set user vibes' })
  @ApiBody({ type: SetVibesDto })
  @ApiResponse({ status: 200, description: 'Vibes saved' })
  @ApiResponse({ status: 400, description: 'Invalid vibe IDs' })
  async setVibes(@CurrentUser('id') userId: string, @Body() dto: SetVibesDto) {
    return this.onboardingService.setVibes(userId, dto);
  }

  @Post('interests')
  @ApiOperation({ summary: 'Step 3: Set user interests' })
  @ApiBody({ type: SetInterestsDto })
  @ApiResponse({ status: 200, description: 'Interests saved' })
  @ApiResponse({ status: 400, description: 'Invalid interest IDs or empty' })
  async setInterests(
    @CurrentUser('id') userId: string,
    @Body() dto: SetInterestsDto,
  ) {
    return this.onboardingService.setInterests(userId, dto);
  }

  @Post('communities')
  @ApiOperation({ summary: 'Step 4: Set user communities' })
  @ApiBody({ type: SetCommunitiesDto })
  @ApiResponse({ status: 200, description: 'Communities saved' })
  @ApiResponse({ status: 400, description: 'Invalid community IDs' })
  async setCommunities(
    @CurrentUser('id') userId: string,
    @Body() dto: SetCommunitiesDto,
  ) {
    return this.onboardingService.setCommunities(userId, dto);
  }

  @Post('agreement')
  @ApiOperation({ summary: 'Step 5: Accept ToS and policies' })
  @ApiBody({ type: AcceptAgreementDto })
  @ApiResponse({ status: 200, description: 'Agreement accepted' })
  @ApiResponse({ status: 400, description: 'accepted must be true' })
  async acceptAgreement(
    @CurrentUser('id') userId: string,
    @Body() dto: AcceptAgreementDto,
  ) {
    return this.onboardingService.acceptAgreement(userId, dto);
  }

  @Post('complete')
  @ApiOperation({ summary: 'Step 6: Mark onboarding complete' })
  @ApiResponse({ status: 200, description: 'Welcome summary' })
  @ApiResponse({ status: 400, description: 'Prerequisites not met' })
  async completeOnboarding(@CurrentUser('id') userId: string) {
    return this.onboardingService.completeOnboarding(userId);
  }
}
