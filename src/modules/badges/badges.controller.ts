import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiBody, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BadgesService } from './badges.service';
import { ApplyBadgeDto } from './dto/apply-badge.dto';

@ApiTags('Badges')
@Controller('badges')
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get('types')
  getBadgeTypes() {
    return this.badgesService.getBadgeTypes();
  }

  @Get('my-status')
  getMyBadgeStatus(@CurrentUser('id') userId: string) {
    return this.badgesService.getMyBadgeStatus(userId);
  }

  @Get('my-applications')
  listMyApplications(@CurrentUser('id') userId: string) {
    return this.badgesService.listMyApplications(userId);
  }

  @Delete('my-applications/:id')
  withdrawApplication(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.badgesService.withdrawApplication(userId, id);
  }

  @Post('apply')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'documents', maxCount: 5 }], {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Multipart form: badgeType, fullLegalName, businessPhone, businessEmail (optional), plus type-specific fields. documents: 1–5 files (JPEG/PNG/PDF, max 10MB each).',
    schema: {
      type: 'object',
      properties: {
        badgeType: { type: 'string', enum: ['LANDLORD', 'RESTAURANT_OWNER', 'AGENCY', 'LOCAL_REVIEWER'] },
        fullLegalName: { type: 'string' },
        businessPhone: { type: 'string' },
        businessEmail: { type: 'string' },
        ownershipType: { type: 'string', enum: ['OWN', 'MANAGE'] },
        propertyAddress: { type: 'string' },
        restaurantName: { type: 'string' },
        restaurantAddress: { type: 'string' },
        agencyName: { type: 'string' },
        agencyLicense: { type: 'string' },
        neighborhoodArea: { type: 'string' },
        reviewerBio: { type: 'string' },
        documents: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  applyForBadge(
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyBadgeDto,
    @UploadedFiles() files: { documents?: Express.Multer.File[] },
  ) {
    const documentFiles = files?.documents ?? [];
    if (documentFiles.length === 0) {
      throw new BadRequestException('At least one document file is required.');
    }
    return this.badgesService.applyForBadge(userId, dto, documentFiles);
  }

  @Get('applications/:id')
  getApplicationById(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.badgesService.getApplicationById(userId, id);
  }

  @Get('applications/:applicationId/documents/:documentId/url')
  getDocumentUrl(
    @CurrentUser() user: { id: string; role: string },
    @Param('applicationId') applicationId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.badgesService.getDocumentUrl(
      user.id,
      user.role,
      applicationId,
      documentId,
    );
  }
}
