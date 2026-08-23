/**
 * SPRINT-56: per-worker env — force test DB + re-run guard.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { assertSafeTestDatabase } from './database-guard';

dotenv.config({ path: path.join(__dirname, '../../.env') }); // SPRINT-56:
dotenv.config({ path: path.join(__dirname, '../../.env.test'), override: true }); // SPRINT-56:

const testUrl =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL?.replace(/\/comlinkr(\?|$)/, '/comlinkr_test$1'); // SPRINT-56:

process.env.DATABASE_URL = testUrl; // SPRINT-56:
process.env.ALLOW_TEST_DATABASE = 'true'; // SPRINT-56:
process.env.NODE_ENV = 'test'; // SPRINT-56:

assertSafeTestDatabase(process.env.DATABASE_URL); // SPRINT-56:
