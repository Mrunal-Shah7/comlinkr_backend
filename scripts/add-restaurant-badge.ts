import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL required');
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminId = '3436c80a-22c8-4438-9b24-7078b74bea60';
  const existing = await prisma.userBadge.findFirst({
    where: { userId: adminId, badgeType: 'RESTAURANT_OWNER' },
  });
  if (existing) {
    console.log('Admin already has RESTAURANT_OWNER badge');
    return;
  }
  const app = await prisma.badgeApplication.create({
    data: {
      userId: adminId,
      badgeType: 'RESTAURANT_OWNER',
      status: 'APPROVED',
      fullLegalName: 'ComLinkr Admin',
      businessPhone: '+15550100',
      restaurantName: 'Test',
      cuisineType: 'Japanese',
      restaurantAddress: '123 Main St',
    },
  });
  await prisma.userBadge.create({
    data: {
      userId: adminId,
      badgeType: 'RESTAURANT_OWNER',
      applicationId: app.id,
    },
  });
  console.log('RESTAURANT_OWNER badge added for admin');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
