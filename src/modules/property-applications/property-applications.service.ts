import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BadgeType,
  DepositStatus,
  ListingStatus,
  Prisma,
  PropertyApplicationStatus as Status,
  SignatureType,
  UserDocumentType,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { resolveMediaUrl } from '../../common/utils/media-url';
import {
  AgreementPdfService,
  decodeSignatureImage,
} from './agreement-pdf.service';
import { parseMoveInDate, regionForListing } from './move-in-date';
import { PersonalInfoDto } from './dto/personal-info.dto';
import { RentalHistoryDto } from './dto/rental-history.dto';
import { FinancialDetailsDto } from './dto/financial-details.dto';
import { AgreementTermsDto } from './dto/agreement-terms.dto';
import { SignApplicationDto } from './dto/sign-application.dto';
import { DecideApplicationDto } from './dto/decide-application.dto';

const APPLICATION_INCLUDE = {
  listing: {
    select: {
      id: true,
      title: true,
      address: true,
      city: true,
      country: true,
      currency: true,
      status: true,
    },
  },
  applicant: {
    select: { id: true, fullName: true, username: true, avatarUrl: true },
  },
  document: { select: { id: true } },
} satisfies Prisma.PropertyApplicationInclude;

type ApplicationRecord = Prisma.PropertyApplicationGetPayload<{
  include: typeof APPLICATION_INCLUDE;
}>;

/** Statuses that block a new application for the same listing. */
const ACTIVE_STATUSES: Status[] = [
  Status.DRAFT,
  Status.SUBMITTED,
  Status.UNDER_REVIEW,
  Status.APPROVED,
  Status.SIGNED,
];
const AWAITING_DECISION: Status[] = [Status.SUBMITTED, Status.UNDER_REVIEW];
/** Statuses the landlord never sees: the tenant has not sent the application. */
const HIDDEN_FROM_LANDLORD: Status[] = [Status.DRAFT, Status.WITHDRAWN];

const DEPOSIT_PAYABLE: Status[] = [Status.APPROVED, Status.SIGNED];

const MOVE_IN_DATE_MESSAGE =
  'moveInDate must be a valid date (YYYY-MM-DD, MM/DD/YYYY for US listings or DD/MM/YYYY otherwise)';

interface StoredPersonalInfo {
  fullName?: string;
  email?: string;
  phone?: string;
}

interface StoredAgreementTerms {
  leaseTerm?: string;
}

/** Validated DTOs are plain JSON once their prototype is stripped in validateBody. */
function toJson(value: object): Prisma.InputJsonObject {
  return value;
}

function invalidStatus(message: string): ConflictException {
  return new ConflictException({ code: 'INVALID_STATUS', message });
}

/** Flattens nested class-validator errors into "path message" strings. */
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): string[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) =>
      parentPath && message.startsWith(error.property)
        ? `${path}${message.slice(error.property.length)}`
        : message,
    );
    return [...own, ...flattenValidationErrors(error.children ?? [], path)];
  });
}

@Injectable()
export class PropertyApplicationsService {
  private readonly logger = new Logger(PropertyApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
    private readonly agreementPdfService: AgreementPdfService,
  ) {}

  // ─── Tenant ────────────────────────────────────────────────────────────────

  async create(userId: string, listingId: string) {
    const listing = await this.prisma.housingListing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        ownerId: true,
        status: true,
        price: true,
        deposit: true,
        currency: true,
      },
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'LISTING_NOT_FOUND',
        message: 'Listing not found',
      });
    }
    if (listing.ownerId === userId) {
      throw new ForbiddenException({
        code: 'OWN_LISTING',
        message: 'You cannot apply for your own listing',
      });
    }

    // The advisory lock serialises concurrent creates for the same tenant and
    // listing, so a double tap cannot produce two active applications.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${listingId}:${userId}`}))`;

      const existing = await tx.propertyApplication.findFirst({
        where: {
          listingId,
          applicantId: userId,
          status: { in: ACTIVE_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
        include: APPLICATION_INCLUDE,
      });
      if (existing) {
        // The app keeps no application id between sessions, so resume the draft.
        if (existing.status === Status.DRAFT) return existing;
        throw new ConflictException({
          code: 'ALREADY_APPLIED',
          message: 'You have already applied for this listing',
        });
      }
      // 404 (not 409) so the app shows "no longer available", not "already applied".
      if (listing.status !== ListingStatus.AVAILABLE) {
        throw new NotFoundException({
          code: 'LISTING_NOT_AVAILABLE',
          message: 'This listing is no longer available',
        });
      }

      return tx.propertyApplication.create({
        data: {
          listingId,
          applicantId: userId,
          landlordId: listing.ownerId,
          rentAmount: listing.price,
          depositAmount: listing.deposit,
          currency: listing.currency,
        },
        include: APPLICATION_INCLUDE,
      });
    });

    return this.toResponse(result);
  }

  async listMine(userId: string) {
    const applications = await this.prisma.propertyApplication.findMany({
      where: { applicantId: userId },
      orderBy: { updatedAt: 'desc' },
      include: APPLICATION_INCLUDE,
    });
    return applications.map((application) => this.toResponse(application));
  }

  async getOne(userId: string, id: string) {
    const application = await this.findOrThrow(id);

    if (application.applicantId === userId) {
      // Self-heal: if the PDF could not be stored at signing time, retry now.
      if (application.status === Status.SIGNED && !application.document) {
        await this.ensureAgreementDocument(application.id);
        return this.toResponse(await this.findOrThrow(id));
      }
      return this.toResponse(application);
    }

    await this.assertLandlordAccess(userId, application);

    // The landlord opening a submitted application starts the review.
    if (application.status === Status.SUBMITTED) {
      await this.prisma.propertyApplication.updateMany({
        where: { id, status: Status.SUBMITTED },
        data: { status: Status.UNDER_REVIEW, reviewedAt: new Date() },
      });
      return this.toResponse(await this.findOrThrow(id));
    }
    return this.toResponse(application);
  }

  async saveStep(userId: string, id: string, step: number, body: unknown) {
    if (!Number.isInteger(step) || step < 1 || step > 5) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'step must be between 1 and 5',
      });
    }
    // Step 5 is the e-signature; it follows the same rules as POST /sign.
    if (step === 5) {
      const signature = await this.validateBody(SignApplicationDto, body);
      return this.sign(userId, id, signature);
    }

    const application = await this.findOrThrow(id);
    this.assertApplicant(userId, application);
    if (application.status !== Status.DRAFT) {
      throw new ConflictException({
        code: 'APPLICATION_LOCKED',
        message:
          'This application has been submitted and can no longer be edited',
      });
    }

    const region = regionForListing(application.listing);
    const data: Prisma.PropertyApplicationUpdateInput = {
      currentStep: Math.max(application.currentStep, Math.min(step + 1, 5)),
    };

    if (step === 1) {
      const dto = await this.validateBody(PersonalInfoDto, body);
      const moveInDate = this.parseMoveInDateOrThrow(dto.moveInDate, region);
      data.personalInfo = toJson({
        ...dto,
        moveInDate: moveInDate.toISOString().slice(0, 10),
      });
      data.moveInDate = moveInDate;
    } else if (step === 2) {
      data.rentalHistory = toJson(
        await this.validateBody(RentalHistoryDto, body),
      );
    } else if (step === 3) {
      data.financialDetails = toJson(
        await this.validateBody(FinancialDetailsDto, body),
      );
    } else {
      const dto = await this.validateBody(AgreementTermsDto, body);
      const moveInDate = this.parseMoveInDateOrThrow(dto.moveInDate, region);
      data.agreementTerms = {
        leaseTerm: dto.leaseTerm,
        moveInDate: moveInDate.toISOString().slice(0, 10),
        termsRead: dto.termsRead,
        termsAgreed: dto.termsAgreed,
        // Amounts always come from the listing snapshot, never from the client.
        rentAmount: application.rentAmount?.toNumber() ?? null,
        depositAmount: application.depositAmount?.toNumber() ?? null,
      };
      data.moveInDate = moveInDate;
    }

    const updated = await this.prisma.propertyApplication.update({
      where: { id },
      data,
      include: APPLICATION_INCLUDE,
    });
    return this.toResponse(updated);
  }

  async submit(userId: string, id: string) {
    const application = await this.findOrThrow(id);
    this.assertApplicant(userId, application);

    if (application.status !== Status.DRAFT) {
      if (
        application.status === Status.REJECTED ||
        application.status === Status.WITHDRAWN
      ) {
        throw invalidStatus(
          `This application was ${application.status.toLowerCase()} and cannot be submitted`,
        );
      }
      // Already submitted: return it so a retried tap is harmless.
      return this.toResponse(application);
    }

    if (!application.personalInfo) {
      throw new BadRequestException({
        code: 'STEP_INCOMPLETE',
        message: 'Complete step 1 (your details) before submitting',
      });
    }
    if (application.listing.status !== ListingStatus.AVAILABLE) {
      throw new ConflictException({
        code: 'LISTING_NOT_AVAILABLE',
        message: 'This listing is no longer available',
      });
    }

    const { count } = await this.prisma.propertyApplication.updateMany({
      where: { id, status: Status.DRAFT },
      data: { status: Status.SUBMITTED, submittedAt: new Date() },
    });
    const updated = await this.findOrThrow(id);
    if (count === 0) return this.toResponse(updated);

    await this.notify({
      userId: application.landlordId,
      actorId: userId,
      title: 'New tenancy application',
      body: `${this.tenantName(updated)} applied for ${updated.listing.title}`,
      applicationId: id,
    });
    return this.toResponse(updated);
  }

  /**
   * The tenant may sign once the application is submitted. The application only
   * becomes SIGNED when the landlord has also approved it; until then the
   * signature is stored and the status stays where it is.
   */
  async sign(userId: string, id: string, dto: SignApplicationDto) {
    const application = await this.findOrThrow(id);
    this.assertApplicant(userId, application);

    if (application.tenantSignedAt) {
      return this.toResponse(application);
    }
    if (application.status === Status.DRAFT) {
      throw new ConflictException({
        code: 'NOT_SUBMITTED',
        message: 'Submit the application before signing',
      });
    }
    if (
      application.status === Status.REJECTED ||
      application.status === Status.WITHDRAWN
    ) {
      throw invalidStatus(
        `This application was ${application.status.toLowerCase()} and cannot be signed`,
      );
    }

    const signatureType =
      dto.signatureType === 'drawn' ? SignatureType.DRAWN : SignatureType.TYPED;
    if (
      signatureType === SignatureType.DRAWN &&
      !decodeSignatureImage(dto.signature)
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'signature must be a base64 PNG or JPEG image when signatureType is drawn',
      });
    }
    if (
      signatureType === SignatureType.TYPED &&
      dto.signature.trim().length > 200
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'signature must be at most 200 characters when typed',
      });
    }

    const now = new Date();
    const { count } = await this.prisma.propertyApplication.updateMany({
      where: {
        id,
        tenantSignedAt: null,
        status: { in: [...AWAITING_DECISION, Status.APPROVED] },
      },
      data: {
        signature:
          signatureType === SignatureType.TYPED
            ? dto.signature.trim()
            : dto.signature,
        signatureType,
        tenantSignedAt: now,
      },
    });
    if (count === 0) {
      // Lost a race with a decision or a parallel sign; report the current state.
      return this.toResponse(await this.findOrThrow(id));
    }

    if (application.status === Status.APPROVED) {
      const finalised = await this.finaliseIfReady(id);
      if (finalised) {
        await this.notify({
          userId: application.landlordId,
          actorId: userId,
          title: 'Tenancy agreement signed',
          body: `${this.tenantName(application)} signed the agreement for ${application.listing.title}`,
          applicationId: id,
        });
      }
    }
    return this.toResponse(await this.findOrThrow(id));
  }

  async withdraw(userId: string, id: string) {
    const application = await this.findOrThrow(id);
    this.assertApplicant(userId, application);

    if (application.status === Status.WITHDRAWN) {
      return this.toResponse(application);
    }
    if (application.status !== Status.DRAFT) {
      throw invalidStatus(
        'Only applications that have not been submitted can be withdrawn',
      );
    }
    const { count } = await this.prisma.propertyApplication.updateMany({
      where: { id, status: Status.DRAFT },
      data: { status: Status.WITHDRAWN, withdrawnAt: new Date() },
    });
    const updated = await this.findOrThrow(id);
    if (count === 0 && updated.status !== Status.WITHDRAWN) {
      throw invalidStatus(
        'Only applications that have not been submitted can be withdrawn',
      );
    }
    return this.toResponse(updated);
  }

  // ─── Landlord ──────────────────────────────────────────────────────────────

  async listReceived(userId: string) {
    await this.assertLandlordBadge(userId);
    const applications = await this.prisma.propertyApplication.findMany({
      where: { landlordId: userId, status: { notIn: HIDDEN_FROM_LANDLORD } },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      include: APPLICATION_INCLUDE,
    });
    return applications.map((application) => this.toResponse(application));
  }

  async decide(userId: string, id: string, dto: DecideApplicationDto) {
    const application = await this.findOrThrow(id);
    if (application.applicantId === userId) {
      throw new ForbiddenException({
        code: 'NOT_LANDLORD',
        message: 'Only the landlord can approve or reject this application',
      });
    }
    await this.assertLandlordAccess(userId, application);

    if (!AWAITING_DECISION.includes(application.status)) {
      throw invalidStatus('This application has already been decided');
    }

    const now = new Date();
    const approved = dto.decision === 'approved';
    const { count } = await this.prisma.propertyApplication.updateMany({
      where: { id, status: { in: AWAITING_DECISION } },
      data: {
        status: approved ? Status.APPROVED : Status.REJECTED,
        decidedAt: now,
        reviewedAt: application.reviewedAt ?? now,
        landlordNote: dto.note?.trim() || null,
      },
    });
    if (count === 0) {
      throw invalidStatus('This application has already been decided');
    }

    const finalised = approved ? await this.finaliseIfReady(id) : false;
    const updated = await this.findOrThrow(id);

    const listingTitle = updated.listing.title;
    let body: string;
    if (!approved) {
      body = `Your application for ${listingTitle} was not accepted.`;
    } else if (finalised) {
      body = `Your application for ${listingTitle} was approved. The signed agreement is in My Documents.`;
    } else {
      body = `Your application for ${listingTitle} was approved. Sign the agreement to finish.`;
    }
    await this.notify({
      userId: application.applicantId,
      actorId: userId,
      title: approved ? 'Application approved' : 'Application rejected',
      body: dto.note?.trim()
        ? `${body} Note from the landlord: ${dto.note.trim()}`
        : body,
      applicationId: id,
    });

    return this.toResponse(updated);
  }

  // ─── Deposit ───────────────────────────────────────────────────────────────

  async getDeposit(userId: string, id: string) {
    const application = await this.findOrThrow(id);
    if (application.applicantId !== userId) {
      await this.assertLandlordAccess(userId, application);
    }
    return this.toDepositResponse(application);
  }

  /**
   * No payment provider is integrated yet: this records the request and issues
   * a reference number, and paymentUrl stays null until a provider is added.
   */
  async payDeposit(userId: string, id: string) {
    const application = await this.findOrThrow(id);
    this.assertApplicant(userId, application);

    if (!DEPOSIT_PAYABLE.includes(application.status)) {
      throw new ConflictException({
        code: 'DEPOSIT_NOT_DUE',
        message:
          'The deposit can be paid once the landlord approves your application',
      });
    }
    if (!application.depositAmount || application.depositAmount.lte(0)) {
      throw new ConflictException({
        code: 'NO_DEPOSIT',
        message: 'This listing does not require a deposit',
      });
    }
    if (application.depositStatus !== DepositStatus.PENDING) {
      throw new ConflictException({
        code: 'DEPOSIT_ALREADY_PAID',
        message: `The deposit is already ${application.depositStatus.toLowerCase()}`,
      });
    }

    const referenceNumber =
      application.depositReference ??
      `DEP-${randomBytes(5).toString('hex').toUpperCase()}`;
    await this.prisma.propertyApplication.update({
      where: { id },
      data: {
        depositReference: referenceNumber,
        depositRequestedAt: new Date(),
      },
    });

    return {
      paymentUrl: null,
      referenceNumber,
      amount: application.depositAmount.toNumber(),
      currency: application.currency,
      status: 'pending',
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async findOrThrow(id: string): Promise<ApplicationRecord> {
    const application = await this.prisma.propertyApplication.findUnique({
      where: { id },
      include: APPLICATION_INCLUDE,
    });
    if (!application) {
      throw new NotFoundException({
        code: 'APPLICATION_NOT_FOUND',
        message: 'Application not found',
      });
    }
    return application;
  }

  /** Only the applicant may change the application; strangers get a 404. */
  private assertApplicant(userId: string, application: ApplicationRecord) {
    if (application.applicantId === userId) return;
    if (application.landlordId === userId) {
      throw new ForbiddenException({
        code: 'NOT_APPLICANT',
        message: 'Only the applicant can change this application',
      });
    }
    throw new NotFoundException({
      code: 'APPLICATION_NOT_FOUND',
      message: 'Application not found',
    });
  }

  /** Listing owner with a LANDLORD badge, and only once the tenant has submitted. */
  private async assertLandlordAccess(
    userId: string,
    application: ApplicationRecord,
  ) {
    if (
      application.landlordId !== userId ||
      HIDDEN_FROM_LANDLORD.includes(application.status)
    ) {
      throw new NotFoundException({
        code: 'APPLICATION_NOT_FOUND',
        message: 'Application not found',
      });
    }
    await this.assertLandlordBadge(userId);
  }

  private async assertLandlordBadge(userId: string) {
    const badge = await this.prisma.userBadge.findFirst({
      where: { userId, badgeType: BadgeType.LANDLORD },
      select: { id: true },
    });
    if (!badge) {
      throw new ForbiddenException({
        code: 'BADGE_REQUIRED',
        message:
          'You need a verified landlord badge to manage applications. Apply for verification in Settings.',
      });
    }
  }

  private async validateBody<T extends object>(
    dtoClass: new () => T,
    body: unknown,
  ): Promise<T> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request body must be a JSON object',
      });
    }
    const instance = plainToInstance(dtoClass, body);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      // An array message is turned into VALIDATION_ERROR with field details by the global filter.
      throw new BadRequestException(flattenValidationErrors(errors));
    }
    // Strip the class prototype so the value can be stored as JSON.
    return JSON.parse(JSON.stringify(instance)) as T;
  }

  private parseMoveInDateOrThrow(value: string, region: 'US' | 'UK'): Date {
    const date = parseMoveInDate(value, region);
    if (!date) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: MOVE_IN_DATE_MESSAGE,
      });
    }
    return date;
  }

  /**
   * Moves an approved application whose tenant has signed to SIGNED and stores
   * the agreement in the tenant's documents. Returns true if this call did it.
   */
  private async finaliseIfReady(id: string): Promise<boolean> {
    const { count } = await this.prisma.propertyApplication.updateMany({
      where: { id, status: Status.APPROVED, tenantSignedAt: { not: null } },
      data: { status: Status.SIGNED, signedAt: new Date() },
    });
    if (count === 0) return false;
    await this.ensureAgreementDocument(id);
    return true;
  }

  /** Best effort: a storage failure must not undo the signing. getOne retries it. */
  private async ensureAgreementDocument(id: string): Promise<void> {
    try {
      await this.createAgreementDocument(id);
    } catch (error) {
      this.logger.error(
        `Could not store the tenancy agreement for application ${id}`,
        error as Error,
      );
    }
  }

  private async createAgreementDocument(id: string): Promise<void> {
    const application = await this.prisma.propertyApplication.findUnique({
      where: { id },
      include: {
        listing: {
          select: { title: true, address: true, city: true, leaseTerm: true },
        },
        applicant: {
          select: { fullName: true, email: true, phoneNumber: true },
        },
        landlord: { select: { fullName: true } },
        document: { select: { id: true } },
      },
    });
    if (
      !application ||
      application.document ||
      application.status !== Status.SIGNED ||
      !application.signature ||
      !application.signatureType ||
      !application.tenantSignedAt
    ) {
      return;
    }

    const personalInfo = (application.personalInfo ?? {}) as StoredPersonalInfo;
    const agreementTerms = (application.agreementTerms ??
      {}) as StoredAgreementTerms;
    const pdf = await this.agreementPdfService.render({
      applicationId: application.id,
      listingTitle: application.listing.title,
      propertyAddress: [application.listing.address, application.listing.city]
        .filter(Boolean)
        .join(', '),
      landlordName: application.landlord.fullName,
      tenantName: personalInfo.fullName ?? application.applicant.fullName,
      tenantEmail: personalInfo.email ?? application.applicant.email,
      tenantPhone: personalInfo.phone ?? application.applicant.phoneNumber,
      rentAmount: application.rentAmount?.toString() ?? null,
      depositAmount: application.depositAmount?.toString() ?? null,
      currency: application.currency,
      leaseTerm: agreementTerms.leaseTerm ?? application.listing.leaseTerm,
      moveInDate: application.moveInDate,
      signature: application.signature,
      signatureType: application.signatureType,
      tenantSignedAt: application.tenantSignedAt,
      approvedAt: application.decidedAt ?? application.signedAt ?? new Date(),
    });

    const fileKey = await this.storageService.uploadPrivateFile(
      pdf,
      'application/pdf',
      `documents/${application.applicantId}`,
      randomUUID(),
      'pdf',
    );

    try {
      await this.prisma.userDocument.create({
        data: {
          userId: application.applicantId,
          type: UserDocumentType.TENANCY_AGREEMENT,
          title: `Tenancy agreement - ${application.listing.title}`.slice(
            0,
            200,
          ),
          fileKey,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
          propertyApplicationId: application.id,
        },
      });
    } catch (error) {
      // A concurrent request already stored the document; drop our duplicate upload.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.storageService.deleteFile(fileKey).catch(() => undefined);
        return;
      }
      throw error;
    }
  }

  private async notify(params: {
    userId: string;
    actorId: string;
    title: string;
    body: string;
    applicationId: string;
  }) {
    try {
      await this.notificationsService.createNotification({
        userId: params.userId,
        actorId: params.actorId,
        type: 'SYSTEM',
        title: params.title,
        body: params.body,
        referenceType: 'PROPERTY_APPLICATION',
        referenceId: params.applicationId,
      });
    } catch (error) {
      this.logger.error(
        `Notification failed for application ${params.applicationId}`,
        error as Error,
      );
    }
  }

  private tenantName(application: ApplicationRecord): string {
    const personalInfo = (application.personalInfo ?? {}) as StoredPersonalInfo;
    return personalInfo.fullName ?? application.applicant.fullName;
  }

  private toResponse(application: ApplicationRecord) {
    const landlordDecision =
      application.status === Status.APPROVED ||
      application.status === Status.SIGNED
        ? 'approved'
        : application.status === Status.REJECTED
          ? 'rejected'
          : null;

    return {
      id: application.id,
      listingId: application.listingId,
      listingTitle: application.listing.title,
      listing: {
        id: application.listing.id,
        title: application.listing.title,
        address: application.listing.address,
        city: application.listing.city,
      },
      applicantId: application.applicantId,
      applicant: {
        id: application.applicant.id,
        fullName: application.applicant.fullName,
        username: application.applicant.username,
        avatarUrl: resolveMediaUrl(
          application.applicant.avatarUrl,
          this.storageService.getPublicBaseUrl(),
        ),
      },
      landlordId: application.landlordId,
      status: application.status.toLowerCase(),
      currentStep: application.currentStep,
      personalInfo: application.personalInfo,
      rentalHistory: application.rentalHistory,
      financialDetails: application.financialDetails,
      agreementTerms: application.agreementTerms,
      moveInDate: application.moveInDate?.toISOString().slice(0, 10) ?? null,
      rentAmount: application.rentAmount?.toNumber() ?? null,
      depositAmount: application.depositAmount?.toNumber() ?? null,
      currency: application.currency,
      signature: application.tenantSignedAt
        ? {
            signature: application.signature,
            signatureType: application.signatureType?.toLowerCase() ?? null,
            signedAt: application.tenantSignedAt.toISOString(),
          }
        : null,
      landlordDecision,
      landlordNote: application.landlordNote,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt,
      decidedAt: application.decidedAt,
      signedAt: application.signedAt,
      withdrawnAt: application.withdrawnAt,
      documentId: application.document?.id ?? null,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }

  private toDepositResponse(application: ApplicationRecord) {
    return {
      applicationId: application.id,
      amount: application.depositAmount?.toNumber() ?? null,
      currency: application.currency,
      status: application.depositStatus.toLowerCase(),
      scheme: application.depositScheme,
      referenceNumber: application.depositReference,
      requestedAt: application.depositRequestedAt,
      heldAt: application.depositHeldAt,
      releaseDate: application.depositReleasedAt,
    };
  }
}
