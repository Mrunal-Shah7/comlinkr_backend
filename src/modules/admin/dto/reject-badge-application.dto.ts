import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectBadgeApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  adminNotes!: string;
}
