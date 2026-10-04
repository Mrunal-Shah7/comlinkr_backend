/**
 * Unit tests for PropertyApplicationsService. Prisma is replaced by a small
 * in-memory fake so the status guards in updateMany behave like the real query.
 */
/* eslint-disable @typescript-eslint/require-await -- fake Prisma methods are async to mirror the real API */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PropertyApplicationsService } from '../../src/modules/property-applications/property-applications.service';
import {
  parseMoveInDate,
  regionForListing,
} from '../../src/modules/property-applications/move-in-date';

const TENANT = 'tenant-1';
const LANDLORD = 'landlord-1';
const STRANGER = 'stranger-1';

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (
      condition &&
      typeof condition === 'object' &&
      !Array.isArray(condition)
    ) {
      if ('in' in condition) return condition.in.includes(value);
      if ('notIn' in condition) return !condition.notIn.includes(value);
      if ('not' in condition) return value !== condition.not;
    }
    return value === condition;
  });
}

function createFakePrisma() {
  const users: Record<string, Row> = {
    [TENANT]: {
      id: TENANT,
      fullName: 'Tina Tenant',
      username: 'tina',
      avatarUrl: null,
      email: 'tina@example.com',
      phoneNumber: null,
    },
    [LANDLORD]: {
      id: LANDLORD,
      fullName: 'Larry Landlord',
      username: 'larry',
      avatarUrl: null,
      email: 'larry@example.com',
      phoneNumber: null,
    },
    [STRANGER]: {
      id: STRANGER,
      fullName: 'Sam Stranger',
      username: 'sam',
      avatarUrl: null,
      email: 'sam@example.com',
      phoneNumber: null,
    },
  };
  const listings: Record<string, Row> = {
    'listing-uk': {
      id: 'listing-uk',
      ownerId: LANDLORD,
      status: 'AVAILABLE',
      title: 'Flat in Camden',
      address: '1 High St',
      city: 'London',
      country: 'United Kingdom',
      leaseTerm: '12 months',
      price: new Prisma.Decimal(1500),
      deposit: new Prisma.Decimal(1730),
      currency: 'GBP',
    },
    'listing-us': {
      id: 'listing-us',
      ownerId: LANDLORD,
      status: 'AVAILABLE',
      title: 'Brooklyn loft',
      address: '2 Main St',
      city: 'New York',
      country: 'US',
      leaseTerm: null,
      price: new Prisma.Decimal(2500),
      deposit: null,
      currency: 'USD',
    },
    'listing-rented': {
      id: 'listing-rented',
      ownerId: LANDLORD,
      status: 'RENTED',
      title: 'Taken',
      address: '3 Low St',
      city: 'London',
      country: 'UK',
      leaseTerm: null,
      price: new Prisma.Decimal(900),
      deposit: null,
      currency: 'GBP',
    },
  };
  const applications: Record<string, Row> = {};
  const documents: Row[] = [];
  const badges: Row[] = [
    { id: 'badge-1', userId: LANDLORD, badgeType: 'LANDLORD' },
  ];
  let seq = 0;

  const hydrate = (row: Row | undefined) =>
    row && {
      ...row,
      listing: listings[row.listingId],
      applicant: users[row.applicantId],
      landlord: users[row.landlordId],
      document:
        documents.find((d) => d.propertyApplicationId === row.id) ?? null,
    };

  const prisma: any = {
    housingListing: {
      findUnique: jest.fn(async ({ where }) => listings[where.id] ?? null),
    },
    userBadge: {
      findFirst: jest.fn(
        async ({ where }) =>
          badges.find(
            (b) => b.userId === where.userId && b.badgeType === where.badgeType,
          ) ?? null,
      ),
    },
    userDocument: {
      create: jest.fn(async ({ data }) => {
        const doc = { id: `doc-${++seq}`, ...data };
        documents.push(doc);
        return doc;
      }),
    },
    propertyApplication: {
      findUnique: jest.fn(
        async ({ where }) => hydrate(applications[where.id]) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }) =>
          hydrate(
            Object.values(applications).find((row) => matches(row, where)),
          ) ?? null,
      ),
      findMany: jest.fn(async ({ where }) =>
        Object.values(applications)
          .filter((row) => matches(row, where))
          .map(hydrate),
      ),
      create: jest.fn(async ({ data }) => {
        const id = `app-${++seq}`;
        applications[id] = {
          id,
          status: 'DRAFT',
          currentStep: 1,
          personalInfo: null,
          rentalHistory: null,
          financialDetails: null,
          agreementTerms: null,
          moveInDate: null,
          signature: null,
          signatureType: null,
          tenantSignedAt: null,
          landlordNote: null,
          submittedAt: null,
          reviewedAt: null,
          decidedAt: null,
          signedAt: null,
          withdrawnAt: null,
          depositStatus: 'PENDING',
          depositReference: null,
          depositScheme: null,
          depositRequestedAt: null,
          depositHeldAt: null,
          depositReleasedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        return hydrate(applications[id]);
      }),
      update: jest.fn(async ({ where, data }) => {
        Object.assign(applications[where.id], data, { updatedAt: new Date() });
        return hydrate(applications[where.id]);
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = Object.values(applications).filter((row) =>
          matches(row, where),
        );
        rows.forEach((row) =>
          Object.assign(row, data, { updatedAt: new Date() }),
        );
        return { count: rows.length };
      }),
    },
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };

  return { prisma, applications, listings, documents, badges };
}

const validStepOne = {
  fullName: 'Tina Tenant',
  currentAddress: '10 Old Road, London',
  email: 'tina@example.com',
  phone: '+44 7700 900000',
  employmentType: 'full_time',
  employerName: 'NHS',
  monthlyIncome: 2500,
  incomeBand: '£25k–35k',
  additionalOccupants: 1,
  hasPets: false,
  petDescription: '',
  smoking: false,
  moveInDate: '04/05/2026',
  previousLandlordReference: 'Ref from Mr Smith',
  notes: '',
  viewingStatus: 'in_person',
};

const typedSignature = {
  signature: 'Tina Tenant',
  signatureType: 'typed' as const,
  signedAt: new Date().toISOString(),
};

describe('PropertyApplicationsService', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: PropertyApplicationsService;
  let notifications: { createNotification: jest.Mock };
  let storage: {
    uploadPrivateFile: jest.Mock;
    deleteFile: jest.Mock;
    getPublicBaseUrl: jest.Mock;
  };
  let pdf: { render: jest.Mock };

  beforeEach(() => {
    fake = createFakePrisma();
    notifications = { createNotification: jest.fn().mockResolvedValue({}) };
    storage = {
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValue('image:pdf:documents/tenant-1/file'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getPublicBaseUrl: jest.fn().mockReturnValue('https://cdn.example.com'),
    };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')) };
    service = new PropertyApplicationsService(
      fake.prisma,
      notifications as any,
      storage as any,
      pdf as any,
    );
  });

  async function draftWithStepOne(listingId = 'listing-uk') {
    const app = await service.create(TENANT, listingId);
    await service.saveStep(TENANT, app.id, 1, { ...validStepOne });
    return app.id;
  }

  async function submitted() {
    const id = await draftWithStepOne();
    await service.submit(TENANT, id);
    notifications.createNotification.mockClear();
    return id;
  }

  describe('create', () => {
    it('returns 404 "Listing not found" for an unknown listing', async () => {
      await expect(service.create(TENANT, 'nope')).rejects.toMatchObject({
        response: { message: 'Listing not found' },
      });
      await expect(service.create(TENANT, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects applying for your own listing', async () => {
      await expect(
        service.create(LANDLORD, 'listing-uk'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a listing that is not AVAILABLE with a 404 (app shows "no longer available")', async () => {
      await expect(
        service.create(TENANT, 'listing-rented'),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'LISTING_NOT_AVAILABLE' },
      });
    });

    it('snapshots rent and deposit from the listing', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      expect(app).toMatchObject({
        status: 'draft',
        rentAmount: 1500,
        depositAmount: 1730,
        currency: 'GBP',
        landlordId: LANDLORD,
      });
    });

    it('resumes the existing draft instead of creating another', async () => {
      const first = await service.create(TENANT, 'listing-uk');
      const second = await service.create(TENANT, 'listing-uk');
      expect(second.id).toBe(first.id);
      expect(Object.keys(fake.applications)).toHaveLength(1);
    });

    it('returns 409 ALREADY_APPLIED once an application is submitted', async () => {
      await submitted();
      await expect(service.create(TENANT, 'listing-uk')).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_APPLIED' },
      });
    });

    it('allows a new application after withdrawing a draft', async () => {
      const first = await service.create(TENANT, 'listing-uk');
      await service.withdraw(TENANT, first.id);
      const second = await service.create(TENANT, 'listing-uk');
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('saveStep', () => {
    it('stores step 1 and parses a UK display date as DD/MM/YYYY', async () => {
      const id = await draftWithStepOne('listing-uk');
      const app = await service.getOne(TENANT, id);
      expect(app.moveInDate).toBe('2026-05-04');
      expect(app.personalInfo).toMatchObject({
        email: 'tina@example.com',
        moveInDate: '2026-05-04',
      });
      expect(app.currentStep).toBe(2);
    });

    it('parses a US display date as MM/DD/YYYY', async () => {
      const id = await draftWithStepOne('listing-us');
      expect((await service.getOne(TENANT, id)).moveInDate).toBe('2026-04-05');
    });

    it('accepts an ISO move-in date', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      const saved = await service.saveStep(TENANT, app.id, 1, {
        ...validStepOne,
        moveInDate: '2026-12-01',
      });
      expect(saved.moveInDate).toBe('2026-12-01');
    });

    it('returns a 400 naming the field for an impossible date', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      await expect(
        service.saveStep(TENANT, app.id, 1, {
          ...validStepOne,
          moveInDate: '31/02/2026',
        }),
      ).rejects.toMatchObject({
        response: { message: expect.stringContaining('moveInDate') },
      });
    });

    it.each([
      ['employmentType', { employmentType: 'Employed' }],
      ['email', { email: undefined }],
      ['phone', { phone: undefined }],
      ['monthlyIncome', { monthlyIncome: '£25k–35k' }],
      ['viewingStatus', { viewingStatus: 'maybe' }],
    ])(
      'returns a 400 naming %s when it is invalid',
      async (field, override) => {
        const app = await service.create(TENANT, 'listing-uk');
        const error = await service
          .saveStep(TENANT, app.id, 1, { ...validStepOne, ...override })
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BadRequestException);
        const messages = (error as BadRequestException).getResponse() as {
          message: string[];
        };
        expect(messages.message.some((m) => m.startsWith(field))).toBe(true);
      },
    );

    it('rejects unknown fields', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      const error = (await service
        .saveStep(TENANT, app.id, 1, { ...validStepOne, hacker: true })
        .catch((e: unknown) => e)) as BadRequestException;
      expect((error.getResponse() as { message: string[] }).message).toContain(
        'property hacker should not exist',
      );
    });

    it('names nested fields in step 2 references', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      const error = (await service
        .saveStep(TENANT, app.id, 2, {
          references: [{ name: '', phone: '1', relationship: 'boss' }],
        })
        .catch((e: unknown) => e)) as BadRequestException;
      expect((error.getResponse() as { message: string[] }).message[0]).toMatch(
        /^references\.0\.name /,
      );
    });

    it('ignores client rent and deposit on step 4', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      const saved = await service.saveStep(TENANT, app.id, 4, {
        rentAmount: 1,
        depositAmount: 1,
        leaseTerm: '12 months',
        moveInDate: '2026-06-01',
        termsRead: true,
        termsAgreed: true,
      });
      expect(saved.agreementTerms).toMatchObject({
        rentAmount: 1500,
        depositAmount: 1730,
      });
    });

    it('requires termsAgreed on step 4', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      await expect(
        service.saveStep(TENANT, app.id, 4, {
          leaseTerm: '12 months',
          moveInDate: '2026-06-01',
          termsRead: true,
          termsAgreed: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks edits once submitted', async () => {
      const id = await submitted();
      await expect(
        service.saveStep(TENANT, id, 1, { ...validStepOne }),
      ).rejects.toMatchObject({
        response: { code: 'APPLICATION_LOCKED' },
      });
    });

    it('lets only the applicant edit', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      await expect(
        service.saveStep(LANDLORD, app.id, 1, { ...validStepOne }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.saveStep(STRANGER, app.id, 1, { ...validStepOne }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a step outside 1 to 5', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      await expect(
        service.saveStep(TENANT, app.id, 6, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('submit', () => {
    it('requires step 1 first', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      await expect(service.submit(TENANT, app.id)).rejects.toMatchObject({
        response: { code: 'STEP_INCOMPLETE' },
      });
    });

    it('submits and notifies the landlord', async () => {
      const id = await draftWithStepOne();
      const result = await service.submit(TENANT, id);
      expect(result.status).toBe('submitted');
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: LANDLORD,
          referenceType: 'PROPERTY_APPLICATION',
          referenceId: id,
        }),
      );
    });

    it('is safe to retry and does not notify twice', async () => {
      const id = await submitted();
      const again = await service.submit(TENANT, id);
      expect(again.status).toBe('submitted');
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('still succeeds if the notification fails', async () => {
      notifications.createNotification.mockRejectedValueOnce(
        new Error('push down'),
      );
      const id = await draftWithStepOne();
      await expect(service.submit(TENANT, id)).resolves.toMatchObject({
        status: 'submitted',
      });
    });
  });

  describe('sign (tenant signs after submit, signed after approval)', () => {
    it('rejects signing a draft', async () => {
      const id = await draftWithStepOne();
      await expect(
        service.sign(TENANT, id, typedSignature),
      ).rejects.toMatchObject({
        response: { code: 'NOT_SUBMITTED' },
      });
    });

    it('stores the signature but keeps the status while awaiting a decision', async () => {
      const id = await submitted();
      const result = await service.sign(TENANT, id, typedSignature);
      expect(result.status).toBe('submitted');
      expect(result.signature).toMatchObject({
        signature: 'Tina Tenant',
        signatureType: 'typed',
      });
      expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    });

    it('matches the app flow: submit then sign immediately', async () => {
      const id = await draftWithStepOne();
      await service.submit(TENANT, id);
      await expect(
        service.sign(TENANT, id, typedSignature),
      ).resolves.toMatchObject({ status: 'submitted' });
    });

    it('is safe to retry', async () => {
      const id = await submitted();
      await service.sign(TENANT, id, typedSignature);
      await expect(
        service.sign(TENANT, id, typedSignature),
      ).resolves.toBeDefined();
    });

    it('rejects a drawn signature that is not an image', async () => {
      const id = await submitted();
      await expect(
        service.sign(TENANT, id, {
          ...typedSignature,
          signatureType: 'drawn',
          signature: 'not-an-image',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('finalises to signed and stores the PDF when signing after approval', async () => {
      const id = await submitted();
      await service.decide(LANDLORD, id, { decision: 'approved' });
      const result = await service.sign(TENANT, id, typedSignature);
      expect(result.status).toBe('signed');
      expect(result.documentId).toBeTruthy();
      expect(storage.uploadPrivateFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        'application/pdf',
        `documents/${TENANT}`,
        expect.any(String),
        'pdf',
      );
    });

    it('rejects signing a rejected application', async () => {
      const id = await submitted();
      await service.decide(LANDLORD, id, { decision: 'rejected' });
      await expect(
        service.sign(TENANT, id, typedSignature),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('landlord', () => {
    it('moves a submitted application to under_review when the landlord opens it', async () => {
      const id = await submitted();
      expect((await service.getOne(LANDLORD, id)).status).toBe('under_review');
    });

    it('hides drafts from the landlord', async () => {
      const id = await draftWithStepOne();
      await expect(service.getOne(LANDLORD, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await service.listReceived(LANDLORD)).toHaveLength(0);
    });

    it('hides applications from strangers', async () => {
      const id = await submitted();
      await expect(service.getOne(STRANGER, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('requires the LANDLORD badge', async () => {
      const id = await submitted();
      fake.badges.length = 0;
      await expect(service.listReceived(LANDLORD)).rejects.toMatchObject({
        response: { code: 'BADGE_REQUIRED' },
      });
      await expect(
        service.decide(LANDLORD, id, { decision: 'approved' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not let the tenant decide', async () => {
      const id = await submitted();
      await expect(
        service.decide(TENANT, id, { decision: 'approved' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('approving an already-signed application makes it signed and saves the PDF', async () => {
      const id = await submitted();
      await service.sign(TENANT, id, typedSignature);
      const result = await service.decide(LANDLORD, id, {
        decision: 'approved',
        note: 'Welcome!',
      });
      expect(result.status).toBe('signed');
      expect(fake.documents).toHaveLength(1);
      expect(fake.documents[0]).toMatchObject({
        userId: TENANT,
        type: 'TENANCY_AGREEMENT',
      });
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TENANT,
          title: 'Application approved',
        }),
      );
    });

    it('approving before the tenant signs leaves it approved', async () => {
      const id = await submitted();
      const result = await service.decide(LANDLORD, id, {
        decision: 'approved',
      });
      expect(result).toMatchObject({
        status: 'approved',
        landlordDecision: 'approved',
      });
    });

    it('rejects and notifies the tenant', async () => {
      const id = await submitted();
      const result = await service.decide(LANDLORD, id, {
        decision: 'rejected',
        note: 'Sorry',
      });
      expect(result).toMatchObject({
        status: 'rejected',
        landlordNote: 'Sorry',
      });
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TENANT,
          title: 'Application rejected',
        }),
      );
    });

    it('rejects a second decision', async () => {
      const id = await submitted();
      await service.decide(LANDLORD, id, { decision: 'rejected' });
      await expect(
        service.decide(LANDLORD, id, { decision: 'approved' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('keeps the signing when PDF storage fails, and retries on the next read', async () => {
      storage.uploadPrivateFile.mockRejectedValueOnce(
        new Error('cloudinary down'),
      );
      const id = await submitted();
      await service.sign(TENANT, id, typedSignature);
      const decided = await service.decide(LANDLORD, id, {
        decision: 'approved',
      });
      expect(decided).toMatchObject({ status: 'signed', documentId: null });

      const reread = await service.getOne(TENANT, id);
      expect(reread.documentId).toBeTruthy();
    });
  });

  describe('withdraw', () => {
    it('withdraws a draft (soft)', async () => {
      const app = await service.create(TENANT, 'listing-uk');
      const result = await service.withdraw(TENANT, app.id);
      expect(result.status).toBe('withdrawn');
      expect(fake.applications[app.id]).toBeDefined();
    });

    it('rejects withdrawing after submit', async () => {
      const id = await submitted();
      await expect(service.withdraw(TENANT, id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('deposit', () => {
    it('is not payable before approval', async () => {
      const id = await submitted();
      await expect(service.payDeposit(TENANT, id)).rejects.toMatchObject({
        response: { code: 'DEPOSIT_NOT_DUE' },
      });
    });

    it('issues a stable reference number after approval', async () => {
      const id = await submitted();
      await service.decide(LANDLORD, id, { decision: 'approved' });
      const first = await service.payDeposit(TENANT, id);
      expect(first).toMatchObject({
        paymentUrl: null,
        amount: 1730,
        currency: 'GBP',
      });
      expect(first.referenceNumber).toMatch(/^DEP-[0-9A-F]{10}$/);
      const second = await service.payDeposit(TENANT, id);
      expect(second.referenceNumber).toBe(first.referenceNumber);
    });

    it('reports the deposit to both parties', async () => {
      const id = await submitted();
      await expect(service.getDeposit(TENANT, id)).resolves.toMatchObject({
        amount: 1730,
        status: 'pending',
      });
      await expect(service.getDeposit(LANDLORD, id)).resolves.toMatchObject({
        applicationId: id,
      });
      await expect(service.getDeposit(STRANGER, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('parseMoveInDate', () => {
  it.each([
    ['2026-04-05', 'UK', '2026-04-05'],
    ['2026-04-05T10:00:00.000Z', 'US', '2026-04-05'],
    ['04/05/2026', 'UK', '2026-05-04'],
    ['04/05/2026', 'US', '2026-04-05'],
    ['4/5/2026', 'US', '2026-04-05'],
  ] as const)('parses %s for %s', (input, region, expected) => {
    expect(parseMoveInDate(input, region)?.toISOString().slice(0, 10)).toBe(
      expected,
    );
  });

  it.each(['31/02/2026', '13/13/2026', 'next week', '2026-02-30'])(
    'rejects %s',
    (input) => {
      expect(parseMoveInDate(input, 'UK')).toBeNull();
    },
  );

  it('mirrors the app market heuristic (address keywords or GBP => UK, else US)', () => {
    expect(
      regionForListing({ address: '1 High St, London', currency: 'USD' }),
    ).toBe('UK');
    expect(
      regionForListing({ address: '5 Deansgate, Manchester', currency: null }),
    ).toBe('UK');
    expect(
      regionForListing({ address: '9 Elm Rd, Leeds', currency: 'gbp' }),
    ).toBe('UK');
    expect(
      regionForListing({ address: '2 Main St, New York', currency: 'USD' }),
    ).toBe('US');
    expect(
      regionForListing({ address: '10 King St, Toronto', currency: 'CAD' }),
    ).toBe('US');
    expect(regionForListing({ address: null, currency: null })).toBe('US');
  });
});
