import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, IsUUID } from 'class-validator';

export class SetInterestsDto {
  @ApiProperty({
    description: 'Selected interest IDs (at least one)',
    type: [String],
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one interest' })
  @IsUUID('4', { each: true })
  interestIds: string[];
}
