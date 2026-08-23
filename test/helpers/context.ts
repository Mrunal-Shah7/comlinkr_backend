/**
 * SPRINT-56: Nest application-context helper (no HTTP) for service-level coverage.
 */
import { NestFactory, type NestApplicationContext } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { assertSafeTestDatabase } from '../setup/database-guard';

export async function createAppContext(): Promise<NestApplicationContext> {
  // SPRINT-56:
  assertSafeTestDatabase(process.env.DATABASE_URL); // SPRINT-56:
  return NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  }); // SPRINT-56:
}
