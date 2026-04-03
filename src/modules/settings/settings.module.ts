import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsCronService } from './settings.cron';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingsCronService],
})
export class SettingsModule {}
