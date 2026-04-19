import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './modules/storage/storage.module';
import { UsersModule } from './modules/users/users.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { FeedModule } from './modules/feed/feed.module';
import { CommunityModule } from './modules/community/community.module';
import { AuthModule } from './modules/auth/auth.module';
import { HousingModule } from './modules/housing/housing.module';
import { RoommatesModule } from './modules/roommates/roommates.module';
import { FoodModule } from './modules/food/food.module';
import { EventsModule } from './modules/events/events.module';
import { StoriesModule } from './modules/stories/stories.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { PostsModule } from './modules/posts/posts.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { BadgesModule } from './modules/badges/badges.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AdminModule } from './modules/admin/admin.module';
import { NewsModule } from './modules/news/news.module';
import { SavesModule } from './modules/saves/saves.module';
import { SharedSpacesModule } from './modules/shared-spaces/shared-spaces.module';
import { AuthGuard } from './common/guards/auth.guard';
import { OnboardingGuard } from './common/guards/onboarding.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
    PrismaModule,
    RedisModule,
    StorageModule,
    UsersModule,
    OnboardingModule,
    FeedModule,
    CommunityModule,
    AuthModule,
    HousingModule,
    RoommatesModule,
    FoodModule,
    EventsModule,
    StoriesModule,
    ChallengesModule,
    PostsModule,
    MessagingModule,
    BadgesModule,
    NotificationsModule,
    SettingsModule,
    AdminModule,
    NewsModule,
    SavesModule,
    SharedSpacesModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OnboardingGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
