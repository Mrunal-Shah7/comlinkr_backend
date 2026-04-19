import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedSpacesController } from './shared-spaces.controller';
import { SharedSpacesService } from './shared-spaces.service';

@Module({
  imports: [PrismaModule],
  controllers: [SharedSpacesController],
  providers: [SharedSpacesService],
})
export class SharedSpacesModule {}
