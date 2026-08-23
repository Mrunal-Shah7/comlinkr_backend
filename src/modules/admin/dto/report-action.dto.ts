import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// SPRINT-51: action vocabulary for POST /admin/reports/:id/action
export enum AdminReportAction {
  WARN = 'WARN',
  SUSPEND = 'SUSPEND',
  REMOVE_CONTENT = 'REMOVE_CONTENT',
  REMOVE_MESSAGE = 'REMOVE_MESSAGE', // SPRINT-51 / SPRINT-53
  BAN_FROM_CHAT = 'BAN_FROM_CHAT', // SPRINT-53: conversation-scoped ban (replaces deferred CHAT_BAN name)
  CHAT_BAN = 'CHAT_BAN', // SPRINT-53: alias kept for Sprint 51 vocabulary compatibility
}

export class ReportActionDto {
  @ApiProperty({ enum: AdminReportAction })
  @IsEnum(AdminReportAction)
  action: AdminReportAction;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Required for SUSPEND; duration in days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;
}
