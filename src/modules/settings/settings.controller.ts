import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SettingsService } from './settings.service';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdatePrivacyDto } from './dto/update-privacy.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { UpdateCultureDto } from './dto/update-culture.dto';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('account')
  getAccount(@CurrentUser('id') userId: string) {
    return this.settingsService.getAccount(userId);
  }

  @Patch('account')
  updateAccount(@CurrentUser('id') userId: string, @Body() dto: UpdateAccountDto) {
    return this.settingsService.updateAccount(userId, dto);
  }

  @Get('privacy')
  getPrivacy(@CurrentUser('id') userId: string) {
    return this.settingsService.getPrivacy(userId);
  }

  @Patch('privacy')
  updatePrivacy(@CurrentUser('id') userId: string, @Body() dto: UpdatePrivacyDto) {
    return this.settingsService.updatePrivacy(userId, dto);
  }

  @Get('blocked-users')
  getBlockedUsers(@CurrentUser('id') userId: string) {
    return this.settingsService.getBlockedUsers(userId);
  }

  @Post('blocked-users')
  @HttpCode(HttpStatus.OK)
  blockUser(@CurrentUser('id') userId: string, @Body() dto: BlockUserDto) {
    return this.settingsService.blockUser(userId, dto);
  }

  @Delete('blocked-users/:userId')
  unblockUser(@CurrentUser('id') userId: string, @Param('userId') targetUserId: string) {
    return this.settingsService.unblockUser(userId, targetUserId);
  }

  @Patch('city')
  updateCity(@CurrentUser('id') userId: string, @Body() dto: UpdateCityDto) {
    return this.settingsService.updateCity(userId, dto);
  }

  @Patch('culture')
  updateCulture(@CurrentUser('id') userId: string, @Body() dto: UpdateCultureDto) {
    return this.settingsService.updateCulture(userId, dto);
  }

  @Post('delete-account')
  async requestDeletion(@CurrentUser('id') userId: string, @Req() req: Request) {
    const result = await this.settingsService.requestAccountDeletion(userId);
    return new Promise<typeof result>((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  @Post('cancel-deletion')
  cancelDeletion(@CurrentUser('id') userId: string) {
    return this.settingsService.cancelDeletion(userId);
  }
}
