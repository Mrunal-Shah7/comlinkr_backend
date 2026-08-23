/**
 * SPRINT-56: fail-closed database safety guard (CJS for globalSetup).
 */
function assertSafeTestDatabase(connectionUrl) {
  // SPRINT-56:
  if (!connectionUrl || typeof connectionUrl !== 'string') {
    throw new Error(
      'SPRINT-56 safety guard: DATABASE_URL is missing. Refusing to run tests.',
    );
  }

  if (process.env.ALLOW_TEST_DATABASE !== 'true') {
    throw new Error(
      'SPRINT-56 safety guard: ALLOW_TEST_DATABASE must be exactly "true". Refusing to run tests.',
    );
  }

  let pathname;
  try {
    pathname = new URL(connectionUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error(
      'SPRINT-56 safety guard: DATABASE_URL is not a valid URL. Refusing to run tests.',
    );
  }

  const dbName = pathname.split('/').filter(Boolean).pop() || '';

  if (dbName === 'comlinkr' || dbName === 'postgres' || dbName === '') {
    throw new Error(
      `SPRINT-56 safety guard: refusing non-test database name "${dbName}". Use a database whose name ends with _test.`,
    );
  }

  if (!dbName.endsWith('_test')) {
    throw new Error(
      `SPRINT-56 safety guard: database name "${dbName}" must end with "_test". Refusing to run tests.`,
    );
  }
}

module.exports = { assertSafeTestDatabase };
