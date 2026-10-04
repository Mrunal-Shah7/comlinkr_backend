import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PropertyApplicationsController } from './property-applications.controller';
import { PropertyApplicationsService } from './property-applications.service';
import { AgreementPdfService } from './agreement-pdf.service';

@Module({
  imports: [PrismaModule],
  controllers: [PropertyApplicationsController],
  providers: [PropertyApplicationsService, AgreementPdfService],
})
export class PropertyApplicationsModule {}
