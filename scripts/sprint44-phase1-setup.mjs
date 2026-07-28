import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PASSWORD = 'Sprint44Test!234';

async function upsertTestUser(email, username, fullName) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      username,
      fullName,
      role: 'USER',
      onboardingCompleted: true,
      authProviders: {
        create: { provider: 'LOCAL', passwordHash },
      },
    },
    update: {
      username,
      fullName,
      onboardingCompleted: true,
      isActive: true,
      deletedAt: null,
    },
    include: { authProviders: true },
  });

  if (user.authProviders.length === 0) {
    await prisma.authProvider.create({
      data: { userId: user.id, provider: 'LOCAL', passwordHash },
    });
  } else {
    await prisma.authProvider.updateMany({
      where: { userId: user.id, provider: 'LOCAL' },
      data: { passwordHash },
    });
  }

  return user;
}

async function main() {
  const a = await upsertTestUser(
    'sprint44a@comlinkr.test',
    'sprint44a',
    'Sprint44 User A',
  );
  const b = await upsertTestUser(
    'sprint44b@comlinkr.test',
    'sprint44b',
    'Sprint44 User B',
  );

  await prisma.blockedUser.deleteMany({
    where: {
      OR: [
        { blockerId: a.id, blockedId: b.id },
        { blockerId: b.id, blockedId: a.id },
      ],
    },
  });

  const shared = await prisma.conversation.findMany({
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: a.id } } },
        { members: { some: { userId: b.id } } },
      ],
    },
    select: { id: true },
  });
  const convIds = shared.map((c) => c.id);
  if (convIds.length) {
    await prisma.message.deleteMany({
      where: { conversationId: { in: convIds } },
    });
    await prisma.conversationMember.deleteMany({
      where: { conversationId: { in: convIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  }

  console.log(
    JSON.stringify(
      {
        password: PASSWORD,
        userA: { id: a.id, email: a.email, username: a.username },
        userB: { id: b.id, email: b.email, username: b.username },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
