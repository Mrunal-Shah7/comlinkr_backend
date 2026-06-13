import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MessagingModule } from '../messaging/messaging.module';
import { FoodController } from './food.controller';
import { FoodService } from './food.service';

@Module({
  imports: [PrismaModule, MessagingModule],
  controllers: [FoodController],
  providers: [FoodService],
  exports: [FoodService], // SPRINT-29: for UsersController getMyReservations
})
export class FoodModule {}
