/**
 * SPRINT-56: Jest globalSetup (plain JS so Jest can load it without ts-node TS options).
 */
const dotenv = require('dotenv');
const path = require('path');
const { assertSafeTestDatabase } = require('./database-guard.js');

module.exports = async function globalSetup() {
  // SPRINT-56:
  dotenv.config({ path: path.join(__dirname, '../../.env') });
  dotenv.config({
    path: path.join(__dirname, '../../.env.test'),
    override: true,
  });

  const testUrl =
    process.env.TEST_DATABASE_URL ||
    (process.env.DATABASE_URL || '').replace(/\/comlinkr(\?|$)/, '/comlinkr_test$1');

  process.env.DATABASE_URL = testUrl;
  process.env.ALLOW_TEST_DATABASE = 'true';
  process.env.NODE_ENV = 'test';

  assertSafeTestDatabase(process.env.DATABASE_URL);
};
