import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's documents (My Documents)" })
  async listMyDocuments(@CurrentUser('id') userId: string) {
    return this.documentsService.listMyDocuments(userId);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Get a short-lived signed download URL' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDownloadUrl(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.documentsService.getDownloadUrl(userId, id);
  }
}
