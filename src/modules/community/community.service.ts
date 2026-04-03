import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { CreateAnswerDto } from './dto/create-answer.dto';
import { CommunityQueryDto } from './dto/community-query.dto';
import { createPaginationMeta } from '../../common/dto/pagination.dto';

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  private buildAvatarUrl(avatarUrl: string | null): string | null {
    return avatarUrl ?? null;
  }

  private async getUserCity(userId: string): Promise<string | null> {
    const location = await this.prisma.userLocation.findUnique({
      where: { userId },
      select: { city: true },
    });
    return location?.city ?? null;
  }

  private formatQuestion(question: any, currentUserId: string, upvotedIds: Set<string>, savedIds: Set<string>) {
    return {
      id: question.id,
      title: question.title,
      body: question.body,
      category: question.category,
      tags: question.tags,
      upvoteCount: question.upvoteCount,
      answerCount: question.answerCount,
      city: question.city,
      createdAt: question.createdAt,
      author: {
        id: question.author.id,
        username: question.author.username,
        name: question.author.fullName,
        avatarUrl: this.buildAvatarUrl(question.author.avatarUrl),
      },
      isUpvoted: upvotedIds.has(question.id),
      isSaved: savedIds.has(question.id),
      isOwner: question.authorId === currentUserId,
    };
  }

  private formatAnswer(answer: any, currentUserId: string, upvotedIds: Set<string>) {
    return {
      id: answer.id,
      content: answer.content,
      upvoteCount: answer.upvoteCount,
      createdAt: answer.createdAt,
      author: {
        id: answer.author.id,
        username: answer.author.username,
        name: answer.author.fullName,
        avatarUrl: this.buildAvatarUrl(answer.author.avatarUrl),
      },
      isUpvoted: upvotedIds.has(answer.id),
    };
  }

  async getQuestions(userId: string, query: CommunityQueryDto) {
    const fromQuery = query.city?.trim();
    const fromLocation = (await this.getUserCity(userId))?.trim() ?? '';
    const city = fromQuery || fromLocation;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    if (!city) {
      return {
        data: [],
        meta: createPaginationMeta(page, limit, 0),
      };
    }

    // Match `getCommunityStats` / seed data: city comparisons must be case-insensitive,
    // otherwise counts can show N questions while this list returns 0 (e.g. "New York" vs "new york").
    const where: any = {
      city: { equals: city, mode: 'insensitive' },
    };
    if (query.category) {
      where.category = query.category;
    }

    const sort = query.sort ?? 'recent';
    const orderBy =
      sort === 'trending'
        ? [{ upvoteCount: 'desc' as const }, { answerCount: 'desc' as const }]
        : [{ createdAt: 'desc' as const }];

    const [questions, total] = await this.prisma.$transaction([
      this.prisma.communityQuestion.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: true,
        },
      }),
      this.prisma.communityQuestion.count({ where }),
    ]);

    const ids = questions.map((q) => q.id);

    const [upvotes, saves] = await this.prisma.$transaction([
      this.prisma.communityUpvote.findMany({
        where: {
          userId,
          targetType: 'QUESTION',
          targetId: { in: ids },
        },
        select: { targetId: true },
      }),
      this.prisma.communitySave.findMany({
        where: {
          userId,
          questionId: { in: ids },
        },
        select: { questionId: true },
      }),
    ]);

    const upvotedIds = new Set(upvotes.map((u) => u.targetId));
    const savedIds = new Set(saves.map((s) => s.questionId));

    const data = questions.map((q) =>
      this.formatQuestion(q, userId, upvotedIds, savedIds),
    );

    return {
      data,
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async getQuestionById(userId: string, questionId: string) {
    const question = await this.prisma.communityQuestion.findUnique({
      where: { id: questionId },
      include: { author: true },
    });
    if (!question) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Question not found',
      });
    }

    const answers = await this.prisma.communityAnswer.findMany({
      where: { questionId },
      orderBy: [{ upvoteCount: 'desc' }, { createdAt: 'asc' }],
      include: { author: true },
    });

    const [questionUpvotes, questionSaves, answerUpvotes] =
      await this.prisma.$transaction([
        this.prisma.communityUpvote.findMany({
          where: {
            userId,
            targetType: 'QUESTION',
            targetId: questionId,
          },
          select: { targetId: true },
        }),
        this.prisma.communitySave.findMany({
          where: { userId, questionId },
          select: { questionId: true },
        }),
        this.prisma.communityUpvote.findMany({
          where: {
            userId,
            targetType: 'ANSWER',
            targetId: { in: answers.map((a) => a.id) },
          },
          select: { targetId: true },
        }),
      ]);

    const questionUpvotedIds = new Set(questionUpvotes.map((u) => u.targetId));
    const questionSavedIds = new Set(questionSaves.map((s) => s.questionId));
    const answerUpvotedIds = new Set(answerUpvotes.map((u) => u.targetId));

    const formattedQuestion = this.formatQuestion(
      question,
      userId,
      questionUpvotedIds,
      questionSavedIds,
    );
    const formattedAnswers = answers.map((a) =>
      this.formatAnswer(a, userId, answerUpvotedIds),
    );

    return {
      ...formattedQuestion,
      answers: formattedAnswers,
    };
  }

  async createQuestion(userId: string, dto: CreateQuestionDto) {
    const city = await this.getUserCity(userId);
    if (!city) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Set your location before asking questions',
      });
    }

    const created = await this.prisma.communityQuestion.create({
      data: {
        authorId: userId,
        title: dto.title,
        body: dto.body,
        category: dto.category,
        tags: dto.tags ?? [],
        city,
      },
      include: { author: true },
    });

    const upvotedIds = new Set<string>();
    const savedIds = new Set<string>();
    return this.formatQuestion(created, userId, upvotedIds, savedIds);
  }

  async createAnswer(
    userId: string,
    questionId: string,
    dto: CreateAnswerDto,
  ) {
    const question = await this.prisma.communityQuestion.findUnique({
      where: { id: questionId },
      select: { id: true, authorId: true },
    });
    if (!question) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Question not found',
      });
    }
    const authorBlocked = await this.prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId: question.authorId, blockedId: userId } },
    });
    if (authorBlocked) {
      throw new ForbiddenException('You cannot answer this question.');
    }

    const answer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.communityAnswer.create({
        data: {
          questionId,
          authorId: userId,
          content: dto.content,
        },
        include: { author: true },
      });
      await tx.communityQuestion.update({
        where: { id: questionId },
        data: { answerCount: { increment: 1 } },
      });
      return created;
    });

    const upvotedIds = new Set<string>();
    return this.formatAnswer(answer, userId, upvotedIds);
  }

  async toggleQuestionUpvote(userId: string, questionId: string) {
    const question = await this.prisma.communityQuestion.findUnique({
      where: { id: questionId },
      select: { id: true },
    });
    if (!question) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Question not found',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.communityUpvote.findUnique({
        where: {
          userId_targetType_targetId: {
            userId,
            targetType: 'QUESTION',
            targetId: questionId,
          },
        },
      });

      if (existing) {
        await tx.communityUpvote.delete({ where: { id: existing.id } });
        const updated = await tx.communityQuestion.update({
          where: { id: questionId },
          data: { upvoteCount: { decrement: 1 } },
          select: { upvoteCount: true },
        });
        return { upvoted: false, upvoteCount: updated.upvoteCount };
      } else {
        await tx.communityUpvote.create({
          data: {
            userId,
            targetType: 'QUESTION',
            targetId: questionId,
          },
        });
        const updated = await tx.communityQuestion.update({
          where: { id: questionId },
          data: { upvoteCount: { increment: 1 } },
          select: { upvoteCount: true },
        });
        return { upvoted: true, upvoteCount: updated.upvoteCount };
      }
    });

    return result;
  }

  async toggleAnswerUpvote(userId: string, answerId: string) {
    const answer = await this.prisma.communityAnswer.findUnique({
      where: { id: answerId },
      select: { id: true },
    });
    if (!answer) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Answer not found',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.communityUpvote.findUnique({
        where: {
          userId_targetType_targetId: {
            userId,
            targetType: 'ANSWER',
            targetId: answerId,
          },
        },
      });

      if (existing) {
        await tx.communityUpvote.delete({ where: { id: existing.id } });
        const updated = await tx.communityAnswer.update({
          where: { id: answerId },
          data: { upvoteCount: { decrement: 1 } },
          select: { upvoteCount: true },
        });
        return { upvoted: false, upvoteCount: updated.upvoteCount };
      } else {
        await tx.communityUpvote.create({
          data: {
            userId,
            targetType: 'ANSWER',
            targetId: answerId,
          },
        });
        const updated = await tx.communityAnswer.update({
          where: { id: answerId },
          data: { upvoteCount: { increment: 1 } },
          select: { upvoteCount: true },
        });
        return { upvoted: true, upvoteCount: updated.upvoteCount };
      }
    });

    return result;
  }

  async toggleSaveQuestion(userId: string, questionId: string) {
    const question = await this.prisma.communityQuestion.findUnique({
      where: { id: questionId },
      select: { id: true },
    });
    if (!question) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Question not found',
      });
    }

    const existing = await this.prisma.communitySave.findUnique({
      where: {
        userId_questionId: {
          userId,
          questionId,
        },
      },
    });

    if (existing) {
      await this.prisma.communitySave.delete({ where: { id: existing.id } });
      return { saved: false };
    }

    await this.prisma.communitySave.create({
      data: { userId, questionId },
    });
    return { saved: true };
  }

  async getCommunityStats(userId: string, cityOverride?: string) {
    const trimmed = cityOverride?.trim();
    const fromLocation = (await this.getUserCity(userId))?.trim() ?? '';
    const city = trimmed || fromLocation;
    if (!city) {
      return { membersCount: 0, questionsCount: 0, answersCount: 0 };
    }

    const [membersCount, questionsCount, answersCount] =
      await this.prisma.$transaction([
        this.prisma.user.count({
          where: { location: { city: { equals: city, mode: 'insensitive' } } },
        }),
        this.prisma.communityQuestion.count({
          where: { city: { equals: city, mode: 'insensitive' } },
        }),
        this.prisma.communityAnswer.count({
          where: {
            question: { city: { equals: city, mode: 'insensitive' } },
          },
        }),
      ]);

    return { membersCount, questionsCount, answersCount };
  }

  /** Counts from CommunityPollVote rows (one vote per neighbor per poll). */
  private async buildPollVoteCountsMap(
    polls: Array<{ id: string; optionAId: string; optionBId: string }>,
  ): Promise<Map<string, { votesA: number; votesB: number }>> {
    if (polls.length === 0) return new Map();
    const pollIds = polls.map((p) => p.id);
    const allVotes = await this.prisma.communityPollVote.findMany({
      where: { pollId: { in: pollIds } },
      select: { pollId: true, optionId: true },
    });
    const pollById = new Map(polls.map((p) => [p.id, p]));
    const map = new Map<string, { votesA: number; votesB: number }>();
    for (const p of polls) {
      map.set(p.id, { votesA: 0, votesB: 0 });
    }
    for (const v of allVotes) {
      const p = pollById.get(v.pollId);
      if (!p) continue;
      const entry = map.get(v.pollId)!;
      if (v.optionId === p.optionAId) entry.votesA += 1;
      else if (v.optionId === p.optionBId) entry.votesB += 1;
    }
    return map;
  }

  private formatPollRow(
    poll: {
      id: string;
      city: string;
      category: string;
      question: string;
      optionAId: string;
      optionALabel: string;
      optionBId: string;
      optionBLabel: string;
      votesA: number;
      votesB: number;
      expiresAt: Date | null;
      createdAt: Date;
    },
    myVote: string | null,
    counts: { votesA: number; votesB: number },
  ) {
    const total = counts.votesA + counts.votesB;
    return {
      id: poll.id,
      question: poll.question,
      category: poll.category,
      options: [
        { id: poll.optionAId, label: poll.optionALabel, votes: counts.votesA },
        { id: poll.optionBId, label: poll.optionBLabel, votes: counts.votesB },
      ],
      totalVotes: total,
      myVote: myVote ?? undefined,
      expiresAt: (poll.expiresAt ?? new Date(Date.now() + 86400 * 365 * 10)).toISOString(),
      createdAt: poll.createdAt.toISOString(),
    };
  }

  private async ensureDefaultPollsForCity(city: string) {
    const count = await this.prisma.communityPoll.count({
      where: { city: { equals: city, mode: 'insensitive' } },
    });
    if (count > 0) return;

    const defaults: {
      category: string;
      question: string;
      optionALabel: string;
      optionBLabel: string;
      votesA: number;
      votesB: number;
    }[] = [
      {
        category: 'HOUSING',
        question: 'Would you rather live in a tiny studio in the city center or a big house 1 hour away?',
        optionALabel: 'Live in a tiny studio in the city center',
        optionBLabel: 'Live in a big house 1 hour away',
        votesA: 0,
        votesB: 0,
      },
      {
        category: 'FOOD',
        question: 'Would you rather cook at home every day or eat out every meal?',
        optionALabel: 'Cook at home every day',
        optionBLabel: 'Eat out every meal',
        votesA: 0,
        votesB: 0,
      },
      {
        category: 'TRANSIT',
        question: 'Would you rather walk everywhere (< 30 min) or drive with no traffic ever?',
        optionALabel: 'Walk everywhere (< 30 min)',
        optionBLabel: 'Drive with no traffic ever',
        votesA: 0,
        votesB: 0,
      },
    ];

    await this.prisma.communityPoll.createMany({
      data: defaults.map((d) => ({
        city,
        category: d.category,
        question: d.question,
        optionAId: 'a',
        optionALabel: d.optionALabel,
        optionBId: 'b',
        optionBLabel: d.optionBLabel,
        votesA: d.votesA,
        votesB: d.votesB,
      })),
    });
  }

  async getPolls(userId: string, cityOverride?: string) {
    const trimmed = cityOverride?.trim();
    const fromLocation = (await this.getUserCity(userId))?.trim() ?? '';
    const city = trimmed || fromLocation;
    if (!city) {
      return [];
    }

    await this.ensureDefaultPollsForCity(city);

    const polls = await this.prisma.communityPoll.findMany({
      where: {
        city: { equals: city, mode: 'insensitive' },
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (polls.length === 0) return [];

    const pollIds = polls.map((p) => p.id);
    const [myVotes, countsMap] = await Promise.all([
      this.prisma.communityPollVote.findMany({
        where: { userId, pollId: { in: pollIds } },
      }),
      this.buildPollVoteCountsMap(polls),
    ]);
    const voteByPoll = new Map(myVotes.map((v) => [v.pollId, v.optionId]));

    return polls.map((p) =>
      this.formatPollRow(
        p,
        voteByPoll.get(p.id) ?? null,
        countsMap.get(p.id) ?? { votesA: 0, votesB: 0 },
      ),
    );
  }

  async votePoll(userId: string, pollId: string, optionId: string) {
    const poll = await this.prisma.communityPoll.findUnique({
      where: { id: pollId },
    });
    if (!poll || !poll.isActive) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Poll not found',
      });
    }
    if (optionId !== poll.optionAId && optionId !== poll.optionBId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid option',
      });
    }

    const existing = await this.prisma.communityPollVote.findUnique({
      where: { userId_pollId: { userId, pollId } },
    });

    if (existing && existing.optionId === optionId) {
      const countsMap = await this.buildPollVoteCountsMap([poll]);
      return this.formatPollRow(
        poll,
        existing.optionId,
        countsMap.get(poll.id) ?? { votesA: 0, votesB: 0 },
      );
    }

    const oldA = existing ? existing.optionId === poll.optionAId : false;
    const oldB = existing ? existing.optionId === poll.optionBId : false;
    const newA = optionId === poll.optionAId;
    const newB = optionId === poll.optionBId;
    const deltaA = (newA ? 1 : 0) - (oldA ? 1 : 0);
    const deltaB = (newB ? 1 : 0) - (oldB ? 1 : 0);

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.communityPollVote.update({
          where: { id: existing.id },
          data: { optionId },
        });
      } else {
        await tx.communityPollVote.create({
          data: { userId, pollId, optionId },
        });
      }
      await tx.communityPoll.update({
        where: { id: pollId },
        data: {
          votesA: { increment: deltaA },
          votesB: { increment: deltaB },
        },
      });
    });

    const updated = await this.prisma.communityPoll.findUniqueOrThrow({
      where: { id: pollId },
    });
    const v = await this.prisma.communityPollVote.findUnique({
      where: { userId_pollId: { userId, pollId } },
    });
    const countsMap = await this.buildPollVoteCountsMap([updated]);
    return this.formatPollRow(
      updated,
      v?.optionId ?? null,
      countsMap.get(updated.id) ?? { votesA: 0, votesB: 0 },
    );
  }
}


