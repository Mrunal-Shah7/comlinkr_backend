/**
 * SPRINT-56: fail-closed database safety guard.
 * Refuses any connection that is not an unambiguously local test database.
 */
export function assertSafeTestDatabase(connectionUrl: string | undefined): void {
  // SPRINT-56:
  if (!connectionUrl || typeof connectionUrl !== 'string') {
    // SPRINT-56:
    throw new Error(
      // SPRINT-56:
      'SPRINT-56 safety guard: DATABASE_URL is missing. Refusing to run tests.',
    ); // SPRINT-56:
  } // SPRINT-56:

  if (process.env.ALLOW_TEST_DATABASE !== 'true') {
    // SPRINT-56:
    throw new Error(
      // SPRINT-56:
      'SPRINT-56 safety guard: ALLOW_TEST_DATABASE must be exactly "true". Refusing to run tests.',
    ); // SPRINT-56:
  } // SPRINT-56:

  let pathname: string;
  try {
    // SPRINT-56:
    pathname = new URL(connectionUrl).pathname.replace(/^\//, ''); // SPRINT-56:
  } catch {
    // SPRINT-56:
    throw new Error(
      // SPRINT-56:
      'SPRINT-56 safety guard: DATABASE_URL is not a valid URL. Refusing to run tests.',
    ); // SPRINT-56:
  } // SPRINT-56:

  const dbName = pathname.split('/').filter(Boolean).pop() ?? ''; // SPRINT-56:

  if (dbName === 'comlinkr' || dbName === 'postgres' || dbName === '') {
    // SPRINT-56:
    throw new Error(
      // SPRINT-56:
      `SPRINT-56 safety guard: refusing non-test database name "${dbName}". Use a database whose name ends with _test.`,
    ); // SPRINT-56:
  } // SPRINT-56:

  if (!dbName.endsWith('_test')) {
    // SPRINT-56:
    throw new Error(
      // SPRINT-56:
      `SPRINT-56 safety guard: database name "${dbName}" must end with "_test". Refusing to run tests.`,
    ); // SPRINT-56:
  } // SPRINT-56:
}
