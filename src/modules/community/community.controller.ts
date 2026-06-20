import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommunityService } from './community.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CommunityQueryDto } from './dto/community-query.dto';
import { CommunityStatsQueryDto } from './dto/community-stats-query.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { CreateAnswerDto } from './dto/create-answer.dto';
import { VotePollDto } from './dto/vote-poll.dto';

@ApiTags('Community')
@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get('polls')
  @ApiOperation({
    summary: 'Active Would You Rather–style polls for your city',
  })
  @ApiResponse({ status: 200, description: 'List of polls with vote tallies' })
  async getPolls(
    @CurrentUser('id') userId: string,
    @Query('city') city?: string,
  ) {
    return this.communityService.getPolls(userId, city);
  }

  @Post('polls/:id/vote')
  @ApiOperation({
    summary:
      'Vote, change vote, or clear vote (same option again removes your vote)',
  })
  @ApiBody({ type: VotePollDto })
  @ApiResponse({ status: 200, description: 'Updated poll' })
  async votePoll(
    @CurrentUser('id') userId: string,
    @Param('id') pollId: string,
    @Body() dto: VotePollDto,
  ) {
    return this.communityService.votePoll(userId, pollId, dto.optionId);
  }

  @Get('questions')
  @ApiOperation({ summary: 'Get paginated city-scoped community questions' })
  @ApiResponse({ status: 200, description: 'Paginated questions' })
  async getQuestions(
    @CurrentUser('id') userId: string,
    @Query() query: CommunityQueryDto,
  ) {
    return this.communityService.getQuestions(userId, query);
  }

  @Get('questions/saved')
  @ApiOperation({ summary: "Get user's saved community questions" })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Paginated saved questions' })
  async getSavedQuestions(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.communityService.getSavedQuestions(userId, query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get community stats for a city (or user profile city)',
  })
  @ApiResponse({ status: 200, description: 'Members, questions, answers' })
  async getCommunityStats(
    @CurrentUser('id') userId: string,
    @Query() query: CommunityStatsQueryDto,
  ) {
    return this.communityService.getCommunityStats(userId, query.city);
  }

  @Get('questions/:id')
  @ApiOperation({ summary: 'Get question detail with answers' })
  @ApiResponse({ status: 200, description: 'Question with answers' })
  async getQuestionById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.communityService.getQuestionById(userId, id);
  }

  @Post('questions')
  @ApiOperation({ summary: 'Create a community question' })
  @ApiBody({ type: CreateQuestionDto })
  @ApiResponse({ status: 201, description: 'Created question' })
  async createQuestion(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.communityService.createQuestion(userId, dto);
  }

  @Post('questions/:id/answers')
  @ApiOperation({ summary: 'Create an answer for a question' })
  @ApiBody({ type: CreateAnswerDto })
  @ApiResponse({ status: 201, description: 'Created answer' })
  async createAnswer(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateAnswerDto,
  ) {
    return this.communityService.createAnswer(userId, id, dto);
  }

  @Post('questions/:id/upvote')
  @ApiOperation({ summary: 'Toggle upvote on a question' })
  @ApiResponse({ status: 200, description: 'Upvote state and count' })
  async toggleQuestionUpvote(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.communityService.toggleQuestionUpvote(userId, id);
  }

  @Post('questions/:id/save')
  @ApiOperation({ summary: 'Toggle save/bookmark on a question' })
  @ApiResponse({ status: 200, description: 'Save state' })
  async toggleSaveQuestion(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.communityService.toggleSaveQuestion(userId, id);
  }

  @Post('answers/:id/upvote')
  @ApiOperation({ summary: 'Toggle upvote on an answer' })
  @ApiResponse({ status: 200, description: 'Upvote state and count' })
  async toggleAnswerUpvote(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.communityService.toggleAnswerUpvote(userId, id);
  }
}
