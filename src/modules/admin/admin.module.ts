import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminCronService } from './admin.cron'; // SPRINT-51
import { AdminAuditInterceptor } from './admin-audit.interceptor'; // SPRINT-52
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../../prisma/prisma.module'; // SPRINT-52
import { MessagingModule } from '../messaging/messaging.module'; // SPRINT-53
import { StorageModule } from '../storage/storage.module'; // SPRINT-54: story media cleanup on admin delete

@Module({
  imports: [
    NotificationsModule,
    PrismaModule,
    MessagingModule,
    StorageModule, // SPRINT-54
  ], // SPRINT-53: chat moderation
  controllers: [AdminController],
  providers: [AdminService, AdminCronService, AdminAuditInterceptor], // SPRINT-52
})
export class AdminModule {}
