import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateListingReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
