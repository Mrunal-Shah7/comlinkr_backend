import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { HousingController } from './housing.controller';
import { HousingService } from './housing.service';

@Module({
  imports: [PrismaModule],
  controllers: [HousingController],
  providers: [HousingService],
})
export class HousingModule {}
