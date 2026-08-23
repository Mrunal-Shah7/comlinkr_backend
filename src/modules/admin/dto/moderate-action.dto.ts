import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerateActionDto {
  @IsString()
  @IsIn(['approve', 'reject', 'delete', 'hide', 'suspend'])
  action: string;

  // SPRINT-54: optional; listing moderation persists on reject only — feed/restaurant ignore
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
