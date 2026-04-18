import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveBadgeApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string;
}
