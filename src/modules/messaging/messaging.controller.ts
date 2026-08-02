import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { UpdateConversationMuteDto } from './dto/update-conversation-mute.dto'; // SPRINT-45: validated single-boolean mute body
import { AUDIO_MAX_SIZE_BYTES } from '../storage/storage.service'; // SPRINT-36: share the exact audio upload size ceiling with the interceptor

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

  @Post('audio/upload') // SPRINT-36: expose an upload-only endpoint before message creation
  @UseInterceptors(
    // SPRINT-36: follow the existing memory-backed multipart interceptor pattern
    FileInterceptor('file', { limits: { fileSize: AUDIO_MAX_SIZE_BYTES } }), // SPRINT-36: reject oversized audio at the transport boundary
  ) // SPRINT-36: complete audio multipart interceptor
  @ApiConsumes('multipart/form-data') // SPRINT-36: publish the audio request content type
  @ApiBody({
    // SPRINT-36: document the required multipart file contract
    schema: {
      // SPRINT-36: define the upload request shape
      type: 'object', // SPRINT-36: represent the multipart form
      properties: {
        // SPRINT-36: enumerate multipart parts
        file: { type: 'string', format: 'binary' }, // SPRINT-36: accept one audio binary part
      }, // SPRINT-36: complete multipart properties
      required: ['file'], // SPRINT-36: require the audio file part
    }, // SPRINT-36: complete upload schema
  }) // SPRINT-36: complete Swagger upload documentation
  async uploadAudio(
    // SPRINT-36: authenticate through the global guard and current-user decorator
    @CurrentUser('id') userId: string, // SPRINT-36: identify the storage-key owner
    @UploadedFile() file?: Express.Multer.File, // SPRINT-36: receive the in-memory audio file
  ) {
    // SPRINT-36: complete upload endpoint signature
    return this.messagingService.uploadAudio(userId, file); // SPRINT-36: return URL, key, and byte size without creating a message
  } // SPRINT-36: complete audio upload endpoint

  // SPRINT-27: soft-hide — DELETE /:id (distinct from GET /:id/messages, PATCH /:id/read by method + suffix)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async hideConversation(
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
  ) {
    return this.messagingService.hideConversation(userId, conversationId);
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
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'ISO date cursor for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size (default 30)',
  })
  async getMessages(
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum =
      limit != null
        ? Math.min(Math.max(1, parseInt(String(limit), 10)), 100)
        : MESSAGE_LIMIT;
    return this.messagingService.getMessages(
      userId,
      conversationId,
      cursor,
      limitNum,
    );
  }

  @Post(':id/messages')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        type: { type: 'string', enum: ['TEXT', 'IMAGE', 'AUDIO'] }, // SPRINT-36: publish the audio message type
        audioUrl: { type: 'string' }, // SPRINT-36: publish the prior upload URL field
        durationSeconds: { type: 'integer', minimum: 1, maximum: 600 }, // SPRINT-36: publish whole-second duration bounds
        file: { type: 'string', format: 'binary' },
      },
      required: [], // SPRINT-36: service cross-field rules determine required fields by message type
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

  // SPRINT-45: single state-carrying mute route (no toggle) — distinct from PATCH /:id/read by suffix
  @Patch(':id/mute')
  async setConversationMute(
    @CurrentUser('id') userId: string, // SPRINT-45: only the authenticated caller's own row is written
    @Param('id') conversationId: string, // SPRINT-45: target conversation from the path
    @Body() dto: UpdateConversationMuteDto, // SPRINT-45: validated body carrying the desired state
  ) {
    // SPRINT-45: complete mute endpoint signature
    return this.messagingService.setConversationMute(
      userId,
      conversationId,
      dto.isMuted,
    ); // SPRINT-45: delegate to the idempotent service method
  } // SPRINT-45: complete mute endpoint
}
