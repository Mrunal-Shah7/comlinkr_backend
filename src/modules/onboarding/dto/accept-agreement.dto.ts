import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, Equals } from 'class-validator';

export class AcceptAgreementDto {
  @ApiProperty({
    description: 'Must be true to accept Terms, Privacy Policy, and Community Guidelines',
    example: true,
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the agreement to continue' })
  accepted: boolean;
}
