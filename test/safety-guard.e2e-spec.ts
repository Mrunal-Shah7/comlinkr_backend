/**
 * SPRINT-56: Phase 3 — database safety guard self-test.
 */
import { assertSafeTestDatabase } from './setup/database-guard';

describe('SPRINT-56 database safety guard', () => {
  const originalAllow = process.env.ALLOW_TEST_DATABASE; // SPRINT-56:
  const originalUrl = process.env.DATABASE_URL; // SPRINT-56:

  afterEach(() => {
    // SPRINT-56:
    process.env.ALLOW_TEST_DATABASE = originalAllow; // SPRINT-56:
    process.env.DATABASE_URL = originalUrl; // SPRINT-56:
  }); // SPRINT-56:

  it('refuses the primary local development database name', () => {
    // SPRINT-56:
    process.env.ALLOW_TEST_DATABASE = 'true'; // SPRINT-56:
    expect(() =>
      assertSafeTestDatabase(
        'postgresql://postgres:x@localhost:5432/comlinkr',
      ),
    ).toThrow(/refusing non-test database name/); // SPRINT-56:
  }); // SPRINT-56:

  it('refuses when ALLOW_TEST_DATABASE is not true', () => {
    // SPRINT-56:
    process.env.ALLOW_TEST_DATABASE = 'false'; // SPRINT-56:
    expect(() =>
      assertSafeTestDatabase(
        'postgresql://postgres:x@localhost:5432/comlinkr_test',
      ),
    ).toThrow(/ALLOW_TEST_DATABASE/); // SPRINT-56:
  }); // SPRINT-56:

  it('accepts an unambiguous *_test database when allowed', () => {
    // SPRINT-56:
    process.env.ALLOW_TEST_DATABASE = 'true'; // SPRINT-56:
    expect(() =>
      assertSafeTestDatabase(
        'postgresql://postgres:x@localhost:5432/comlinkr_test',
      ),
    ).not.toThrow(); // SPRINT-56:
  }); // SPRINT-56:
});
