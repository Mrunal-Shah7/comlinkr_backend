/**
 * SPRINT-56: fixture isolation — second run sees no leftover users.
 */
import {
  disconnectFixtures,
  getTestPrisma,
  resetDatabase,
  seedAdmin,
} from './helpers/fixtures';

describe('SPRINT-56 fixture isolation', () => {
  afterAll(async () => {
    // SPRINT-56:
    await disconnectFixtures(); // SPRINT-56:
  }); // SPRINT-56:

  it('leaves a clean database across two sequential resets', async () => {
    // SPRINT-56:
    await resetDatabase(); // SPRINT-56:
    const a = await seedAdmin(); // SPRINT-56:
    const prisma = getTestPrisma(); // SPRINT-56:
    expect(await prisma.user.count()).toBe(1); // SPRINT-56:
    expect(a.role).toBe('ADMIN'); // SPRINT-56:

    await resetDatabase(); // SPRINT-56:
    expect(await prisma.user.count()).toBe(0); // SPRINT-56:
    const b = await seedAdmin(); // SPRINT-56:
    expect(await prisma.user.count()).toBe(1); // SPRINT-56:
    expect(b.id).not.toBe(a.id); // SPRINT-56:
  }); // SPRINT-56:
});
