import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger, // SPRINT-32: session destroy warnings on immediate delete
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateAccountDto } from './dto/update-account.dto';
import type { UpdatePrivacyDto } from './dto/update-privacy.dto';
import type { BlockUserDto } from './dto/block-user.dto';
import type { UpdateCityDto } from './dto/update-city.dto';
import type { UpdateCultureDto } from './dto/update-culture.dto';
import { AuthService } from '../auth/auth.service'; // SPRINT-34: revoke Apple authorization before deleting provider data

const PRIVACY_DEFAULTS = {
  publicProfile: true,
  showLocation: true,
  activityStatus: false,
};
const BCRYPT_ROUNDS = 12;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name); // SPRINT-32: immediate delete diagnostics

  constructor( // SPRINT-34: inject the exported auth service for pre-delete Apple revocation
    private readonly prisma: PrismaService, // SPRINT-34: preserve existing database access
    private readonly authService: AuthService, // SPRINT-34: invoke non-blocking Apple authorization revocation
  ) {} // SPRINT-34: complete settings dependencies

  async getAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        username: true,
        fullName: true,
        authProviders: { select: { provider: true, createdAt: true } },
      },
    });
    if (!user) throw new NotFoundException();
    return {
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      providers: user.authProviders.map((p) => ({
        provider: p.provider,
        linkedAt: p.createdAt,
      })),
    };
  }

  async updateAccount(userId: string, dto: UpdateAccountDto) {
    const localProvider = await this.prisma.authProvider.findUnique({
      where: { userId_provider: { userId, provider: 'LOCAL' } },
      select: { passwordHash: true },
    });
    if (!localProvider?.passwordHash) {
      throw new BadRequestException(
        'No password set. Sign in with Google or Apple to manage your account.',
      );
    }
    const match = await bcrypt.compare(
      dto.currentPassword,
      localProvider.passwordHash,
    );
    if (!match) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Current password is incorrect.',
      });
    }
    if (!dto.newEmail && !dto.newPassword && !dto.newUsername) {
      throw new BadRequestException('Provide at least one field to update.');
    }

    if (dto.newEmail) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.newEmail },
      });
      if (existing)
        throw new ConflictException({
          code: 'AUTH_EMAIL_EXISTS',
          message: 'Email already in use.',
        });
      await this.prisma.user.update({
        where: { id: userId },
        data: { email: dto.newEmail },
      });
    }
    if (dto.newUsername) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.newUsername },
      });
      if (existing)
        throw new ConflictException({
          code: 'AUTH_USERNAME_EXISTS',
          message: 'Username already in use.',
        });
      await this.prisma.user.update({
        where: { id: userId },
        data: { username: dto.newUsername },
      });
    }
    if (dto.newPassword) {
      const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
      await this.prisma.authProvider.update({
        where: { userId_provider: { userId, provider: 'LOCAL' } },
        data: { passwordHash: hash },
      });
    }
    return { message: 'Account updated successfully' };
  }

  async getPrivacy(userId: string) {
    const prefs = await this.prisma.privacySettings.findUnique({
      where: { userId },
    });
    return prefs ?? PRIVACY_DEFAULTS;
  }

  async updatePrivacy(userId: string, dto: UpdatePrivacyDto) {
    const data: Record<string, boolean> = { ...PRIVACY_DEFAULTS };
    if (dto.publicProfile !== undefined) data.publicProfile = dto.publicProfile;
    if (dto.showLocation !== undefined) data.showLocation = dto.showLocation;
    if (dto.activityStatus !== undefined)
      data.activityStatus = dto.activityStatus;
    const updated = await this.prisma.privacySettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return updated;
  }

  async getBlockedUsers(userId: string) {
    const list = await this.prisma.blockedUser.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
      },
    });
    return list.map((b) => ({
      id: b.id,
      user: {
        id: b.blocked.id,
        username: b.blocked.username,
        name: b.blocked.fullName,
        avatarUrl: b.blocked.avatarUrl ?? null,
      },
      blockedAt: b.createdAt,
    }));
  }

  async blockUser(userId: string, dto: BlockUserDto) {
    const target = await this.prisma.user.findFirst({
      where: { id: dto.userId, isActive: true, deletedAt: null },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (dto.userId === userId)
      throw new BadRequestException('You cannot block yourself.');
    const existing = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: { blockerId: userId, blockedId: dto.userId },
      },
    });
    if (existing) return { message: 'User is already blocked' };

    await this.prisma.$transaction(async (tx) => {
      await tx.blockedUser.create({
        data: { blockerId: userId, blockedId: dto.userId },
      });
      const blockerMemberships = await tx.conversationMember.findMany({
        where: { userId },
        select: { conversationId: true },
      });
      for (const m of blockerMemberships) {
        const otherInConv = await tx.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: m.conversationId,
              userId: dto.userId,
            },
          },
        });
        if (otherInConv) {
          await tx.conversationMember.updateMany({
            where: { conversationId: m.conversationId, userId },
            data: { status: 'BLOCKED' },
          });
        }
      }
    });
    return { message: 'User blocked' };
  }

  async unblockUser(userId: string, targetUserId: string) {
    const deleted = await this.prisma.blockedUser.deleteMany({
      where: { blockerId: userId, blockedId: targetUserId },
    });
    return {
      message: deleted.count ? 'User unblocked' : 'User was not blocked',
    };
  }

  async updateCity(userId: string, dto: UpdateCityDto) {
    await this.prisma.userLocation.upsert({
      where: { userId },
      create: {
        userId,
        country: dto.country,
        countryCode: dto.countryCode,
        dialCode: dto.dialCode,
        state: dto.state,
        city: dto.city,
      },
      update: {
        country: dto.country,
        countryCode: dto.countryCode,
        dialCode: dto.dialCode,
        state: dto.state,
        city: dto.city,
      },
    });
    return { message: 'City updated' };
  }

  async updateCulture(userId: string, dto: UpdateCultureDto) {
    if (
      !dto.vibeIds?.length &&
      !dto.interestIds?.length &&
      !dto.communityIds?.length
    ) {
      throw new BadRequestException(
        'Provide at least one of vibeIds, interestIds, or communityIds.',
      );
    }
    if (dto.interestIds?.length === 0) {
      throw new BadRequestException('At least one interest is required.');
    }
    if (dto.vibeIds?.length) {
      const count = await this.prisma.vibe.count({
        where: { id: { in: dto.vibeIds } },
      });
      if (count !== dto.vibeIds.length)
        throw new BadRequestException('Invalid vibe ID(s).');
      await this.prisma.user.update({
        where: { id: userId },
        data: { vibes: { set: dto.vibeIds.map((id) => ({ id })) } },
      });
    }
    if (dto.interestIds?.length) {
      const count = await this.prisma.interest.count({
        where: { id: { in: dto.interestIds } },
      });
      if (count !== dto.interestIds.length)
        throw new BadRequestException('Invalid interest ID(s).');
      await this.prisma.user.update({
        where: { id: userId },
        data: { interests: { set: dto.interestIds.map((id) => ({ id })) } },
      });
    }
    if (dto.communityIds?.length) {
      const count = await this.prisma.community.count({
        where: { id: { in: dto.communityIds } },
      });
      if (count !== dto.communityIds.length)
        throw new BadRequestException('Invalid community ID(s).');
      await this.prisma.user.update({
        where: { id: userId },
        data: { communities: { set: dto.communityIds.map((id) => ({ id })) } },
      });
    }
    return { message: 'Preferences updated' };
  }

  async requestAccountDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true },
    });
    if (!user) throw new NotFoundException();
    if (user.isActive === false && user.deletedAt != null) {
      throw new BadRequestException('Account deletion already requested.');
    }
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 15);
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false, deletedAt: deletionDate },
    });
    return {
      message: 'Account scheduled for deletion',
      deletionDate: deletionDate.toISOString(),
    };
  }

  async cancelDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true },
    });
    if (
      !user ||
      user.isActive !== false ||
      !user.deletedAt ||
      user.deletedAt <= new Date()
    ) {
      throw new BadRequestException('No pending account deletion to cancel.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true, deletedAt: null },
    });
    return { message: 'Account deletion cancelled. Welcome back!' };
  }

  /** SPRINT-32: Shared cascading hard-delete used by CRON and immediate-delete endpoint. */
  async performHardDelete(userId: string): Promise<void> {
    await this.authService.revokeAppleAuthorization(userId); // SPRINT-34: revoke exactly once before either immediate or CRON deletion removes the token
    await this.prisma.$transaction(async (tx) => {
      // SPRINT-32: many-to-many join tables (_UserVibes, _UserInterests, _UserCommunities)
      await tx.user.update({
        where: { id: userId },
        data: {
          vibes: { set: [] },
          interests: { set: [] },
          communities: { set: [] },
        },
      });

      const feedPostIds = (
        await tx.feedPost.findMany({
          where: { authorId: userId },
          select: { id: true },
        })
      ).map((p) => p.id);
      if (feedPostIds.length) {
        await tx.feedLike.deleteMany({
          where: { feedPostId: { in: feedPostIds } },
        });
        await tx.feedComment.deleteMany({
          where: { feedPostId: { in: feedPostIds } },
        });
        await tx.feedSave.deleteMany({
          where: { feedPostId: { in: feedPostIds } },
        });
        await tx.feedPostMedia.deleteMany({
          where: { feedPostId: { in: feedPostIds } },
        });
      }
      await tx.feedLike.deleteMany({ where: { userId } });
      await tx.feedComment.deleteMany({ where: { userId } });
      await tx.feedSave.deleteMany({ where: { userId } });
      await tx.feedPost.deleteMany({ where: { authorId: userId } });

      const listingIds = (
        await tx.housingListing.findMany({
          where: { ownerId: userId },
          select: { id: true },
        })
      ).map((l) => l.id);
      if (listingIds.length) {
        await tx.housingSave.deleteMany({
          where: { listingId: { in: listingIds } },
        });
        await tx.housingInterest.deleteMany({
          where: { listingId: { in: listingIds } },
        });
        await tx.housingImage.deleteMany({
          where: { listingId: { in: listingIds } },
        });
      }
      await tx.housingSave.deleteMany({ where: { userId } });
      await tx.housingInterest.deleteMany({ where: { userId } });
      await tx.housingListing.deleteMany({ where: { ownerId: userId } });

      const sharedSpaceIds = (
        await tx.sharedSpace.findMany({
          where: { ownerId: userId },
          select: { id: true },
        })
      ).map((s) => s.id);
      if (sharedSpaceIds.length) {
        await tx.sharedSpaceSave.deleteMany({
          where: { sharedSpaceId: { in: sharedSpaceIds } },
        });
        await tx.sharedSpaceApplication.deleteMany({
          where: { sharedSpaceId: { in: sharedSpaceIds } },
        });
        await tx.sharedSpaceImage.deleteMany({
          where: { sharedSpaceId: { in: sharedSpaceIds } },
        });
      }
      await tx.sharedSpaceSave.deleteMany({ where: { userId } });
      await tx.sharedSpaceApplication.deleteMany({ where: { userId } });
      await tx.sharedSpace.deleteMany({ where: { ownerId: userId } });

      const restaurantIds = (
        await tx.restaurant.findMany({
          where: { ownerId: userId },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (restaurantIds.length) {
        await tx.restaurantSave.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await tx.restaurantFavorite.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await tx.restaurantReservation.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await tx.restaurantReview.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await tx.restaurantImage.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
      }
      await tx.restaurantSave.deleteMany({ where: { userId } });
      await tx.restaurantFavorite.deleteMany({ where: { userId } });
      await tx.restaurantReservation.deleteMany({ where: { userId } });
      await tx.restaurantReview.deleteMany({ where: { userId } });
      await tx.restaurant.deleteMany({ where: { ownerId: userId } });

      const questionIds = (
        await tx.communityQuestion.findMany({
          where: { authorId: userId },
          select: { id: true },
        })
      ).map((q) => q.id);
      if (questionIds.length) {
        const answerIds = (
          await tx.communityAnswer.findMany({
            where: { questionId: { in: questionIds } },
            select: { id: true },
          })
        ).map((a) => a.id);
        if (answerIds.length) {
          await tx.communityUpvote.deleteMany({
            where: { targetType: 'ANSWER', targetId: { in: answerIds } },
          }); // SPRINT-32: upvotes on answers under user's questions
        }
        await tx.communityUpvote.deleteMany({
          where: { targetType: 'QUESTION', targetId: { in: questionIds } },
        }); // SPRINT-32: upvotes on user's questions
        await tx.communityAnswer.deleteMany({
          where: { questionId: { in: questionIds } },
        });
        await tx.communitySave.deleteMany({
          where: { questionId: { in: questionIds } },
        });
      }
      await tx.communityAnswer.deleteMany({ where: { authorId: userId } });
      await tx.communityUpvote.deleteMany({ where: { userId } });
      await tx.communitySave.deleteMany({ where: { userId } });
      await tx.communityQuestion.deleteMany({ where: { authorId: userId } });
      await tx.communityPollVote.deleteMany({ where: { userId } });
      await tx.neighborhoodMoodVote.deleteMany({ where: { userId } });

      const conversationIds = (
        await tx.conversation.findMany({
          where: { createdById: userId },
          select: { id: true },
        })
      ).map((c) => c.id);
      if (conversationIds.length) {
        await tx.message.deleteMany({
          where: { conversationId: { in: conversationIds } },
        });
        await tx.conversationMember.deleteMany({
          where: { conversationId: { in: conversationIds } },
        });
      }
      await tx.message.deleteMany({ where: { senderId: userId } });
      await tx.conversationMember.deleteMany({ where: { userId } });
      await tx.conversation.deleteMany({ where: { createdById: userId } });

      const eventIds = (
        await tx.event.findMany({
          where: { authorId: userId },
          select: { id: true },
        })
      ).map((e) => e.id);
      if (eventIds.length) {
        await tx.eventSave.deleteMany({ where: { eventId: { in: eventIds } } });
        await tx.eventAttendee.deleteMany({
          where: { eventId: { in: eventIds } },
        });
        await tx.eventImage.deleteMany({ where: { eventId: { in: eventIds } } });
      }
      await tx.eventSave.deleteMany({ where: { userId } });
      await tx.eventAttendee.deleteMany({ where: { userId } });
      await tx.event.deleteMany({ where: { authorId: userId } });

      const storyIds = (
        await tx.story.findMany({
          where: { authorId: userId },
          select: { id: true },
        })
      ).map((s) => s.id);
      if (storyIds.length) {
        await tx.storyComment.deleteMany({ where: { storyId: { in: storyIds } } });
        await tx.storyLike.deleteMany({ where: { storyId: { in: storyIds } } });
        await tx.storySave.deleteMany({ where: { storyId: { in: storyIds } } });
      }
      await tx.storyComment.deleteMany({ where: { authorId: userId } });
      await tx.storyLike.deleteMany({ where: { userId } });
      await tx.storySave.deleteMany({ where: { userId } });
      await tx.story.deleteMany({ where: { authorId: userId } });

      const challengeIds = (
        await tx.challenge.findMany({
          where: { authorId: userId },
          select: { id: true },
        })
      ).map((c) => c.id);
      if (challengeIds.length) {
        await tx.challengeParticipant.deleteMany({
          where: { challengeId: { in: challengeIds } },
        });
      }
      await tx.challengeParticipant.deleteMany({ where: { userId } });
      await tx.challenge.deleteMany({ where: { authorId: userId } });

      const applicationIds = (
        await tx.badgeApplication.findMany({
          where: { userId },
          select: { id: true },
        })
      ).map((a) => a.id);
      if (applicationIds.length) {
        await tx.badgeDocument.deleteMany({
          where: { applicationId: { in: applicationIds } },
        });
      }
      await tx.userBadge.deleteMany({ where: { userId } });
      await tx.badgeApplication.deleteMany({ where: { userId } });

      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.privacySettings.deleteMany({ where: { userId } });
      await tx.blockedUser.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });
      await tx.roommateSave.deleteMany({
        where: { OR: [{ userId }, { savedUserId: userId }] },
      });
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.pushDevice.deleteMany({ where: { userId } });
      await tx.broadcastNotification.deleteMany({ where: { sentById: userId } });
      await tx.supportTicket.deleteMany({ where: { userId } });
      await tx.adminPollVote.deleteMany({ where: { userId } });
      const adminPollIds = (
        await tx.adminPoll.findMany({
          where: { createdById: userId },
          select: { id: true },
        })
      ).map((p) => p.id);
      if (adminPollIds.length) {
        await tx.adminPollVote.deleteMany({
          where: { pollId: { in: adminPollIds } },
        });
        await tx.adminPollOption.deleteMany({
          where: { pollId: { in: adminPollIds } },
        });
      }
      await tx.adminPoll.deleteMany({ where: { createdById: userId } });
      await tx.contentReport.deleteMany({ where: { reporterId: userId } });
      await tx.listingReport.deleteMany({ where: { reporterId: userId } });
      await tx.newsArticleLike.deleteMany({ where: { userId } });
      await tx.newsArticleComment.deleteMany({ where: { userId } });
      await tx.newsArticleSave.deleteMany({ where: { userId } });

      await tx.authProvider.deleteMany({ where: { userId } });
      await tx.userLocation.deleteMany({ where: { userId } });
      await tx.roommatePreferences.deleteMany({ where: { userId } });

      await tx.user.delete({ where: { id: userId } });
    });
  }

  /** SPRINT-32: Immediate irreversible account deletion (no 15-day grace period). */
  async deleteAccountImmediately(
    userId: string,
    session: { destroy: (cb: (err?: Error) => void) => void },
  ): Promise<{ deleted: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true },
    });
    if (!user) {
      throw new NotFoundException('User not found'); // SPRINT-32: explicit 404 message
    }
    const now = new Date();
    if (
      user.isActive === false &&
      user.deletedAt != null &&
      user.deletedAt <= now
    ) {
      throw new BadRequestException(
        'Account is already pending deletion or has been deleted',
      ); // SPRINT-32: block double-delete after grace period elapsed
    }

    await new Promise<void>((resolve) => {
      session.destroy((err) => {
        if (err) {
          this.logger.warn(
            `Session destroy failed during immediate delete for user ${userId}: ${err}`,
          ); // SPRINT-32: log but continue with hard delete
        }
        resolve();
      });
    });

    await this.performHardDelete(userId); // SPRINT-32: same cascade as nightly CRON
    return { deleted: true };
  }
}
