import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommunityService } from './community.service';
import { CommunityController } from './community.controller';

@Module({
  imports: [PrismaModule],
  providers: [CommunityService],
  controllers: [CommunityController],
})
export class CommunityModule {}

