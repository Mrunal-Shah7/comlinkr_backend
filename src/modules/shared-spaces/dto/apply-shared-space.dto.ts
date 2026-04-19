import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplySharedSpaceDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
