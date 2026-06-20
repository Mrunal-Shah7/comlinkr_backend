import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RedisService } from './redis/redis.service';
import { getSessionOptions } from './config/session.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const redisService = app.get(RedisService);
  const redisClient = redisService.getClient();
  app.use(session(getSessionOptions(redisClient)));
  app.useWebSocketAdapter(new IoAdapter(app));

  app.setGlobalPrefix('api');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());

  const corsOrigins = configService.get<string>('CORS_ORIGINS', '');
  const originList = corsOrigins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  // Mobile / Expo web: empty CORS_ORIGINS + dev → reflect Origin so LAN testing works.
  app.enableCors({
    origin: originList.includes('*')
      ? true
      : originList.length > 0
        ? originList
        : nodeEnv !== 'production',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const config = new DocumentBuilder()
    .setTitle('ComLinkr API')
    .setDescription('Community-First Housing & Lifestyle Discovery Platform')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');

  console.log(
    `ComLinkr API listening on 0.0.0.0:${port} (e.g. http://localhost:${port}/api)`,
  );
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
void bootstrap();
