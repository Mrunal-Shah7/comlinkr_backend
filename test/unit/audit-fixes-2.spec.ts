/**
 * Unit tests for audit fixes SEC-02 (session epoch), SEC-04 (housing visibility), SEC-13 (presence policy)
 * and SEC-10 (read-only poll GET). Prisma is replaced by minimal fakes.
 */
/* eslint-disable @typescript-eslint/require-await -- fake Prisma methods are async to mirror the real API */
import { NotFoundException } from '@nestjs/common';
import { AuthGuard } from '../../src/common/guards/auth.guard';
import { HousingService } from '../../src/modules/housing/housing.service';
import { MessagingService } from '../../src/modules/messaging/messaging.service';
import { CommunityService } from '../../src/modules/community/community.service';

describe('AuthGuard session epoch (SEC-02)', () => {
  const reflector = { getAllAndOverride: () => false } as any;
  const make = (sessionVersion: number) =>
    new AuthGuard(reflector, {
      user: {
        findUnique: async () => ({
          id: 'u1',
          role: 'USER',
          isActive: true,
          deletedAt: null,
          onboardingCompleted: true,
          sessionVersion,
        }),
      },
    } as any);
  const ctx = (session: any) =>
    ({
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ session }) }),
    }) as any;

  it('accepts a session whose epoch matches (legacy sessions count as 0)', async () => {
    await expect(make(0).canActivate(ctx({ userId: 'u1' }))).resolves.toBe(true);
    await expect(make(2).canActivate(ctx({ userId: 'u1', sv: 2 }))).resolves.toBe(true);
  });

  it('rejects a session issued before the epoch was bumped', async () => {
    await expect(make(1).canActivate(ctx({ userId: 'u1' }))).rejects.toMatchObject({
      status: 401,
    });
    await expect(make(3).canActivate(ctx({ userId: 'u1', sv: 2 }))).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('HousingService.getListingById visibility (SEC-04)', () => {
  const listing = (status: string) => ({
    id: 'l1',
    ownerId: 'owner',
    status,
    images: [],
    interests: [],
    saves: [],
    _count: { interests: 0 },
    owner: { id: 'owner', userBadges: [] },
  });
  const svc = (status: string, viewerRole?: string) => {
    const prisma = {
      housingListing: {
        findUnique: async () => listing(status),
        update: async () => ({}),
      },
      user: { findUnique: async () => (viewerRole ? { role: viewerRole } : null) },
    };
    const service = new HousingService(prisma as any, { getPublicBaseUrl: () => '' } as any);
    (service as any).formatListing = (l: any) => ({ id: l.id, status: l.status });
    return service;
  };

  it('hides non-AVAILABLE listings from guests and other users', async () => {
    await expect(svc('REJECTED').getListingById(undefined, 'l1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc('PENDING').getListingById('someone', 'l1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows AVAILABLE listings to everyone and any status to the owner and admins', async () => {
    await expect(svc('AVAILABLE').getListingById(undefined, 'l1')).resolves.toMatchObject({ id: 'l1' });
    await expect(svc('REJECTED').getListingById('owner', 'l1')).resolves.toMatchObject({ id: 'l1' });
    await expect(svc('REJECTED', 'ADMIN').getListingById('admin1', 'l1')).resolves.toMatchObject({ id: 'l1' });
  });
});

describe('MessagingService.getPresenceRecipientIds (SEC-13)', () => {
  const make = (activityStatus: boolean | undefined, blocks: any[] = []) => {
    const prisma = {
      privacySettings: {
        findUnique: async () => (activityStatus === undefined ? null : { activityStatus }),
      },
      conversationMember: {
        findMany: async (args: any) =>
          args.where.userId === 'me'
            ? [{ conversationId: 'c1' }]
            : [{ userId: 'friend' }, { userId: 'blocked' }],
      },
      blockedUser: { findMany: async () => blocks },
    };
    return new MessagingService(prisma as any, {} as any, {} as any, {} as any);
  };

  it('emits nothing when the user has not opted into activity status', async () => {
    expect(await make(false).getPresenceRecipientIds('me')).toEqual([]);
    expect(await make(undefined).getPresenceRecipientIds('me')).toEqual([]);
  });

  it('limits recipients to accepted partners and drops blocked pairs', async () => {
    const ids = await make(true, [{ blockerId: 'me', blockedId: 'blocked' }]).getPresenceRecipientIds('me');
    expect(ids).toEqual(['friend']);
  });
});

describe('CommunityService.getPolls is read-only (SEC-10)', () => {
  it('returns unsaved templates without writing for an unknown city', async () => {
    const writes: string[] = [];
    const prisma = {
      communityPoll: {
        findMany: async () => [],
        count: async () => 0,
        createMany: async () => {
          writes.push('createMany');
        },
        create: async () => {
          writes.push('create');
        },
      },
      communityPollVote: { findMany: async () => [] },
      user: { findUnique: async () => null },
    };
    const svc = new CommunityService(prisma as any, { getPublicBaseUrl: () => '' } as any);
    const polls = (await svc.getPolls(undefined, 'Nowhereville')) as any[];
    expect(polls).toHaveLength(3);
    expect(polls[0].id).toMatch(/^tpl:0:/);
    expect(writes).toEqual([]);
  });
});
