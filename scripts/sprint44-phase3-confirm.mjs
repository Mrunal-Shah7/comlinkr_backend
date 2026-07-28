import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const total = await prisma.conversationMember.count();
  const falseCount = await prisma.conversationMember.count({
    where: { blockedByUserBlock: false },
  });
  const trueCount = await prisma.conversationMember.count({
    where: { blockedByUserBlock: true },
  });
  const blockedWithFalse = await prisma.conversationMember.count({
    where: { status: 'BLOCKED', blockedByUserBlock: false },
  });
  console.log(
    JSON.stringify(
      { total, falseCount, trueCount, blockedWithFalse },
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
