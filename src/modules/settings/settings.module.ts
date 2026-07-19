import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsCronService } from './settings.cron';
import { AuthModule } from '../auth/auth.module'; // SPRINT-34: provide Apple revocation to the shared hard-delete path

@Module({
  imports: [AuthModule], // SPRINT-34: inject exported AuthService without introducing a module cycle
  controllers: [SettingsController],
  providers: [SettingsService, SettingsCronService],
  exports: [SettingsService], // SPRINT-27: expose for UsersController block/unblock routes
})
export class SettingsModule {}
