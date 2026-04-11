import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RoommatesController } from './roommates.controller';
import { RoommatesService } from './roommates.service';

@Module({
  imports: [PrismaModule],
  controllers: [RoommatesController],
  providers: [RoommatesService],
  exports: [RoommatesService],
})
export class RoommatesModule {}
