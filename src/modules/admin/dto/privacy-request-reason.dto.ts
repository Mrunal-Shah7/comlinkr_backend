import { IsOptional, IsString, MaxLength } from 'class-validator';

// SPRINT-55: optional justification for privacy export / erasure
export class PrivacyRequestReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
