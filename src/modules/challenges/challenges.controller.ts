import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { ChallengesQueryDto } from './dto/challenges-query.dto';

@ApiTags('Challenges')
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Get()
  @ApiOperation({ summary: 'List challenges with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiResponse({ status: 200, description: 'Paginated challenges' })
  async getChallenges(
    @CurrentUser('id') userId: string,
    @Query() query: ChallengesQueryDto,
  ) {
    return this.challengesService.getChallenges(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create challenge' })
  @ApiResponse({ status: 201, description: 'Challenge created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async createChallenge(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChallengeDto,
  ) {
    return this.challengesService.createChallenge(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get challenge by ID with participants' })
  @ApiResponse({ status: 200, description: 'Challenge detail' })
  @ApiResponse({ status: 404, description: 'Challenge not found' })
  async getChallengeById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.challengesService.getChallengeById(userId, id);
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Join challenge' })
  @ApiResponse({ status: 200, description: 'Joined' })
  @ApiResponse({ status: 400, description: 'Ended or full' })
  @ApiResponse({ status: 404, description: 'Challenge not found' })
  async joinChallenge(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.challengesService.joinChallenge(userId, id);
  }
}
