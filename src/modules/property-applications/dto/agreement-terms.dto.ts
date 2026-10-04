import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Step 4 — agreement terms acknowledgement. */
export class AgreementTermsDto {
  @ApiPropertyOptional({ description: 'Ignored; rent comes from the listing' })
  @IsOptional()
  @IsNumber()
  rentAmount?: number;

  @ApiPropertyOptional({
    description: 'Ignored; deposit comes from the listing',
  })
  @IsOptional()
  @IsNumber()
  depositAmount?: number;

  @ApiProperty({ maxLength: 50, example: '12 months' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  leaseTerm: string;

  @ApiProperty({ description: 'Same formats as the step 1 moveInDate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  moveInDate: string;

  @ApiProperty()
  @IsBoolean()
  termsRead: boolean;

  @ApiProperty()
  @Equals(true, { message: 'termsAgreed must be true to continue' })
  termsAgreed: boolean;
}
