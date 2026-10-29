/**
 * Explicit admin bootstrap (SEC-06). Never resets an existing password.
 *
 *   ADMIN_EMAIL=... ADMIN_USERNAME=... ADMIN_FULL_NAME=... ADMIN_PASSWORD=... pnpm seed:admin
 *
 * In production it additionally requires ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const username = process.env.ADMIN_USERNAME?.trim();
  const fullName = process.env.ADMIN_FULL_NAME?.trim() || username;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !username || !password || !fullName) {
    throw new Error('ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD are required');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  }
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PRODUCTION_ADMIN_BOOTSTRAP !== 'true'
  ) {
    throw new Error(
      'Refusing to bootstrap an admin in production without ALLOW_PRODUCTION_ADMIN_BOOTSTRAP=true',
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      include: { authProviders: true },
    });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'ADMIN', onboardingCompleted: true },
      });
      if (!existing.authProviders.some((p) => p.provider === 'LOCAL')) {
        await prisma.authProvider.create({
          data: {
            userId: existing.id,
            provider: 'LOCAL',
            passwordHash: await bcrypt.hash(password, 12),
          },
        });
      }
      console.log(`Promoted existing user to admin (${email}); password unchanged`);
      return;
    }
    await prisma.user.create({
      data: {
        email,
        username,
        fullName,
        role: 'ADMIN',
        onboardingCompleted: true,
        authProviders: {
          create: {
            provider: 'LOCAL',
            passwordHash: await bcrypt.hash(password, 12),
          },
        },
      },
    });
    console.log(`Created admin user (${email})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
