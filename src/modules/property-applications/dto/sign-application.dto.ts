import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export const SIGNATURE_TYPES = ['typed', 'drawn'] as const;

export class SignApplicationDto {
  @ApiProperty({
    description: 'Typed full legal name, or a base64 PNG/JPEG when drawn',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  signature: string;

  @ApiProperty({ enum: SIGNATURE_TYPES })
  @IsIn(SIGNATURE_TYPES, {
    message: `signatureType must be one of: ${SIGNATURE_TYPES.join(', ')}`,
  })
  signatureType: (typeof SIGNATURE_TYPES)[number];

  @ApiProperty({ description: 'Client timestamp (ISO 8601)' })
  @IsISO8601()
  signedAt: string;
}
