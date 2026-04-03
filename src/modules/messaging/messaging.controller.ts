import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessagingService } from './messaging.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateMemberStatusDto } from './dto/update-member-status.dto';
import { ConversationsQueryDto } from './dto/conversations-query.dto';

const MESSAGE_LIMIT = 30;

@ApiTags('Messaging')
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get()
  async getConversations(
    @CurrentUser('id') userId: string,
    @Query() query: ConversationsQueryDto,
  ) {
    return this.messagingService.getConversations(userId, query);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser('id') userId: string) {
    return this.messagingService.getUnreadCount(userId);
  }

  @Post()
  async createConversation(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateConversationDto,
  ) {
    return this.messagingService.createConversation(userId, dto);
  }

  @Get(':id')
  async getConversationById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.messagingService.getConversationById(userId, id);
  }

  @Patch('members/:id/status')
  async updateMemberStatus(
    @CurrentUser('id') userId: string,
    @Param('id') memberId: string,
    @Body() dto: UpdateMemberStatusDto,
  ) {
    return this.messagingService.updateMemberStatus(userId, memberId, dto);
  }

  @Get(':id/messages')
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ISO date cursor for pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (default 30)' })
  async getMessages(
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit != null ? Math.min(Math.max(1, parseInt(String(limit), 10)), 100) : MESSAGE_LIMIT;
    return this.messagingService.getMessages(userId, conversationId, cursor, limitNum);
  }

  @Post(':id/messages')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        type: { type: 'string', enum: ['TEXT', 'IMAGE'] },
        file: { type: 'string', format: 'binary' },
      },
      required: ['content'],
    },
  })
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.messagingService.sendMessage(userId, conversationId, dto, file);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
  ) {
    return this.messagingService.markAsRead(userId, conversationId);
  }
}
