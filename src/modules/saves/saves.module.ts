import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { RoommatesModule } from '../roommates/roommates.module';
import { SavesController } from './saves.controller';
import { SavesService } from './saves.service';

@Module({
  imports: [PrismaModule, StorageModule, RoommatesModule],
  controllers: [SavesController],
  providers: [SavesService],
})
export class SavesModule {}
