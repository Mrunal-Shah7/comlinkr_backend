/**
 * SPRINT-56: Nest test application bootstrap (HTTP + sockets).
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import session from 'express-session';
import { AppModule } from '../../src/app.module';
import { RedisService } from '../../src/redis/redis.service';
import { getSessionOptions } from '../../src/config/session.config';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { assertSafeTestDatabase } from '../setup/database-guard';

export async function createTestApp(): Promise<INestApplication> {
  // SPRINT-56:
  assertSafeTestDatabase(process.env.DATABASE_URL); // SPRINT-56:
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  }); // SPRINT-56:
  const redisService = app.get(RedisService); // SPRINT-56:
  app.use(session(getSessionOptions(redisService.getClient()))); // SPRINT-56:
  app.useWebSocketAdapter(new IoAdapter(app)); // SPRINT-56:
  app.setGlobalPrefix('api'); // SPRINT-56:
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  ); // SPRINT-56:
  app.useGlobalFilters(new HttpExceptionFilter()); // SPRINT-56:
  app.useGlobalInterceptors(new TransformInterceptor()); // SPRINT-56:
  await app.init(); // SPRINT-56:
  await app.listen(0); // SPRINT-56: ephemeral port
  return app; // SPRINT-56:
}

export function appBaseUrl(app: INestApplication): string {
  // SPRINT-56:
  const server = app.getHttpServer(); // SPRINT-56:
  const addr = server.address(); // SPRINT-56:
  const port = typeof addr === 'object' && addr ? addr.port : 0; // SPRINT-56:
  return `http://127.0.0.1:${port}/api`; // SPRINT-56:
}

export function appWsBase(app: INestApplication): string {
  // SPRINT-56:
  const server = app.getHttpServer(); // SPRINT-56:
  const addr = server.address(); // SPRINT-56:
  const port = typeof addr === 'object' && addr ? addr.port : 0; // SPRINT-56:
  return `http://127.0.0.1:${port}`; // SPRINT-56:
}
