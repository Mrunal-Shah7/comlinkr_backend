import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BadgeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { ApplyBadgeDto } from './dto/apply-badge.dto';

const DOC_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DOC_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

const BADGE_TYPES = [
  {
    type: 'LANDLORD',
    name: 'Verified Landlord',
    icon: '🏠',
    color: '#2563EB',
    description: 'Post housing listings & manage properties',
    unlocks: [
      'Post housing listings',
      'Verified badge on listings',
      'Access My Listings dashboard',
      'Direct tenant messaging',
    ],
    requirements: [
      'Government-issued photo ID',
      'Proof of property ownership (Land Registry / mortgage statement / council tax bill)',
      'Phone number for tenant contact',
      'Property address you intend to list',
    ],
    requiredFields: ['fullLegalName', 'businessPhone', 'ownershipType', 'propertyAddress'],
    requiredDocuments: ['GOVERNMENT_ID', 'PROOF_OF_OWNERSHIP'],
  },
  {
    type: 'RESTAURANT_OWNER',
    name: 'Verified Restaurant Owner',
    icon: '🍽️',
    color: '#16A34A',
    description: 'List & manage your restaurant',
    unlocks: [
      'List your restaurant',
      'Verified Business badge',
      'Reply to community reviews',
      'Manage menu & hours',
      'Access My Restaurants dashboard',
    ],
    requirements: [
      'Business registration number / license',
      'Government-issued ID',
      'Business phone and email',
      'Restaurant physical address',
    ],
    requiredFields: ['fullLegalName', 'businessPhone', 'restaurantName', 'restaurantAddress'],
    requiredDocuments: ['GOVERNMENT_ID', 'BUSINESS_LICENSE'],
  },
  {
    type: 'AGENCY',
    name: 'Verified Agency',
    icon: '🏢',
    color: '#EA580C',
    description: 'Post unlimited listings with agency branding',
    unlocks: [
      'Post unlimited housing listings',
      'Agency verified badge',
      'Agency branding on all listings',
      'Priority listing placement',
    ],
    requirements: [
      'Agency business license',
      'Government-issued ID',
      'Company website or portfolio',
      'Agency contact details',
    ],
    requiredFields: ['fullLegalName', 'businessPhone', 'agencyName', 'agencyLicense'],
    requiredDocuments: ['GOVERNMENT_ID', 'BUSINESS_LICENSE'],
  },
  {
    type: 'LOCAL_REVIEWER',
    name: 'Local Reviewer',
    icon: '⭐',
    color: '#D97706',
    description: 'Post community restaurant reviews on ComLinkr',
    unlocks: [
      'Post community restaurant reviews',
      'Local Reviewer badge on your profile',
      'Trusted reviewer indicator on all your reviews',
      'Access to the Community Post form on restaurant listings',
    ],
    requirements: [
      'Government-issued photo ID',
      'Your neighborhood or area you regularly visit',
      'A brief bio about your food interests and local knowledge',
    ],
    requiredFields: ['fullLegalName', 'businessPhone', 'neighborhoodArea', 'reviewerBio'],
    requiredDocuments: ['GOVERNMENT_ID'],
  },
];

const TYPE_REQUIRED_FIELDS: Record<BadgeType, (keyof ApplyBadgeDto)[]> = {
  LANDLORD: ['ownershipType', 'propertyAddress'],
  RESTAURANT_OWNER: ['restaurantName', 'restaurantAddress'],
  AGENCY: ['agencyName', 'agencyLicense'],
  LOCAL_REVIEWER: ['neighborhoodArea', 'reviewerBio'],
};

function getDocumentTypeForIndex(badgeType: BadgeType, index: number): string {
  if (index === 0) return 'GOVERNMENT_ID';
  switch (badgeType) {
    case 'LANDLORD':
      return 'PROOF_OF_OWNERSHIP';
    case 'RESTAURANT_OWNER':
    case 'AGENCY':
      return 'BUSINESS_LICENSE';
    default:
      return 'SUPPORTING_DOCUMENT';
  }
}

@Injectable()
export class BadgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  getBadgeTypes() {
    return BADGE_TYPES;
  }

  async getMyBadgeStatus(userId: string) {
    const [userBadges, applications] = await Promise.all([
      this.prisma.userBadge.findMany({ where: { userId } }),
      this.prisma.badgeApplication.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const badgeTypes: BadgeType[] = ['LANDLORD', 'RESTAURANT_OWNER', 'AGENCY', 'LOCAL_REVIEWER'];
    return badgeTypes.map((badgeType) => {
      const badge = userBadges.find((b) => b.badgeType === badgeType) ?? null;
      const latestApplication = applications.find((a) => a.badgeType === badgeType) ?? null;
      let status: 'NOT_APPLIED' | 'PENDING' | 'APPROVED' | 'REJECTED' = 'NOT_APPLIED';
      if (badge) status = 'APPROVED';
      else if (latestApplication?.status === 'PENDING') status = 'PENDING';
      else if (latestApplication?.status === 'REJECTED') status = 'REJECTED';
      return {
        badgeType,
        status,
        badge: badge ? { id: badge.id, badgeType: badge.badgeType, grantedAt: badge.grantedAt } : null,
        latestApplication: latestApplication
          ? {
              id: latestApplication.id,
              badgeType: latestApplication.badgeType,
              status: latestApplication.status,
              createdAt: latestApplication.createdAt,
            }
          : null,
        grantedAt: badge?.grantedAt ?? null,
      };
    });
  }

  async applyForBadge(userId: string, dto: ApplyBadgeDto, files: Express.Multer.File[]) {
    const existingBadge = await this.prisma.userBadge.findUnique({
      where: { userId_badgeType: { userId, badgeType: dto.badgeType } },
    });
    if (existingBadge) {
      throw new ConflictException('You already have this badge.');
    }
    const pendingApp = await this.prisma.badgeApplication.findFirst({
      where: { userId, badgeType: dto.badgeType, status: 'PENDING' },
    });
    if (pendingApp) {
      throw new ConflictException(
        'You already have a pending application for this badge. Please wait for review.',
      );
    }

    const requiredFields = TYPE_REQUIRED_FIELDS[dto.badgeType];
    for (const field of requiredFields) {
      const value = (dto as any)[field];
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Missing required field: ${field}`,
        });
      }
    }

    if (!files?.length) {
      throw new BadRequestException(
        'At least one document is required (Government-issued ID).',
      );
    }
    for (const file of files) {
      if (file.size > DOC_MAX_SIZE) {
        throw new BadRequestException('Each document must be at most 10MB.');
      }
      if (!DOC_MIME_TYPES.includes(file.mimetype)) {
        throw new BadRequestException(
          'Documents must be image/jpeg, image/png, or application/pdf.',
        );
      }
    }

    const application = await this.prisma.$transaction(async (tx) => {
      const app = await tx.badgeApplication.create({
        data: {
          userId,
          badgeType: dto.badgeType,
          status: 'PENDING',
          fullLegalName: dto.fullLegalName,
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail ?? null,
          ownershipType: dto.ownershipType ?? null,
          propertyAddress: dto.propertyAddress ?? null,
          restaurantName: dto.restaurantName ?? null,
          cuisineType: dto.cuisineType ?? null,
          restaurantAddress: dto.restaurantAddress ?? null,
          agencyName: dto.agencyName ?? null,
          agencyLicense: dto.agencyLicense ?? null,
          propertiesManaged: dto.propertiesManaged ?? null,
          companyWebsite: dto.companyWebsite ?? null,
          neighborhoodArea: dto.neighborhoodArea ?? null,
          reviewerBio: dto.reviewerBio ?? null,
        },
      });
      for (let i = 0; i < files.length; i++) {
        const extension = StorageService.extensionFromMime(files[i].mimetype);
        const documentKey = await this.storageService.uploadPrivateFile(
          files[i].buffer,
          files[i].mimetype,
          `verification-docs/${userId}`,
          randomUUID(),
          extension,
        );
        await tx.badgeDocument.create({
          data: {
            applicationId: app.id,
            documentKey,
            documentType: getDocumentTypeForIndex(dto.badgeType, i),
          },
        });
      }
      return tx.badgeApplication.findUnique({
        where: { id: app.id },
        include: { documents: true },
      });
    });

    return this.formatApplication(application!, userId);
  }

  async getApplicationById(userId: string, applicationId: string) {
    const application = await this.prisma.badgeApplication.findUnique({
      where: { id: applicationId },
      include: {
        documents: true,
        reviewer: { select: { id: true, fullName: true } },
      },
    });
    if (!application) throw new NotFoundException('Application not found.');
    if (application.userId !== userId) throw new ForbiddenException();
    return this.formatApplication(application, userId, true);
  }

  async listMyApplications(userId: string) {
    const applications = await this.prisma.badgeApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: true,
      },
    });
    return applications.map((a) => this.formatApplication(a, userId));
  }

  async withdrawApplication(userId: string, applicationId: string) {
    const application = await this.prisma.badgeApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application || application.userId !== userId) {
      throw new NotFoundException('Application not found.');
    }
    if (application.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending applications can be withdrawn.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.badgeDocument.deleteMany({
        where: { applicationId },
      });
      await tx.badgeApplication.delete({ where: { id: applicationId } });
    });
    return { ok: true };
  }

  async getDocumentUrl(
    currentUserId: string,
    currentUserRole: string,
    applicationId: string,
    documentId: string,
  ) {
    const badgeDocument = await this.prisma.badgeDocument.findFirst({
      where: { id: documentId, applicationId },
    });
    if (!badgeDocument) {
      throw new NotFoundException('Document not found.');
    }
    const application = await this.prisma.badgeApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, userId: true },
    });
    if (!application) {
      throw new NotFoundException('Application not found.');
    }
    const isApplicant = currentUserId === application.userId;
    const isAdmin = currentUserRole === 'ADMIN';
    if (!isApplicant && !isAdmin) {
      throw new ForbiddenException('Forbidden');
    }
    if (!badgeDocument.documentKey) {
      throw new NotFoundException('Document key not found.');
    }
    const url = await this.storageService.getSignedUrl(badgeDocument.documentKey, 900);
    return { url, expiresIn: 900 };
  }

  private formatApplication(
    app: {
      id: string;
      badgeType: string;
      status: string;
      fullLegalName: string;
      businessPhone: string;
      businessEmail: string | null;
      ownershipType: string | null;
      propertyAddress: string | null;
      restaurantName: string | null;
      cuisineType: string | null;
      restaurantAddress: string | null;
      agencyName: string | null;
      agencyLicense: string | null;
      propertiesManaged: number | null;
      companyWebsite: string | null;
      neighborhoodArea: string | null;
      reviewerBio: string | null;
      adminNotes: string | null;
      reviewedAt: Date | null;
      createdAt: Date;
      documents: Array<{ id: string; documentType: string; createdAt: Date; documentKey: string | null }>;
      reviewer?: { id: string; fullName: string } | null;
    },
    _userId: string,
    includeReview = false,
  ) {
    const base: Record<string, unknown> = {
      id: app.id,
      badgeType: app.badgeType,
      status: app.status,
      fullLegalName: app.fullLegalName,
      businessPhone: app.businessPhone,
      businessEmail: app.businessEmail,
      ownershipType: app.ownershipType,
      propertyAddress: app.propertyAddress,
      restaurantName: app.restaurantName,
      cuisineType: app.cuisineType,
      restaurantAddress: app.restaurantAddress,
      agencyName: app.agencyName,
      agencyLicense: app.agencyLicense,
      propertiesManaged: app.propertiesManaged,
      companyWebsite: app.companyWebsite,
      neighborhoodArea: app.neighborhoodArea,
      reviewerBio: app.reviewerBio,
      documents: app.documents.map((d) => ({
        id: d.id,
        documentType: d.documentType,
        createdAt: d.createdAt,
      })),
      createdAt: app.createdAt,
    };
    if (includeReview && app.status !== 'PENDING') {
      base.adminNotes = app.adminNotes;
      base.reviewedAt = app.reviewedAt;
      base.reviewedBy = app.reviewer ? { id: app.reviewer.id, name: app.reviewer.fullName } : null;
    }
    return base;
  }
}

