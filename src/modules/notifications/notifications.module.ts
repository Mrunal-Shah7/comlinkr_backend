import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ExpoNotificationService } from './expo-notification.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ExpoNotificationService],
  exports: [NotificationsService, ExpoNotificationService],
})
export class NotificationsModule {}
