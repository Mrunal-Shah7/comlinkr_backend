import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VotePollDto {
  @ApiProperty({ description: 'Option id (matches poll optionAId or optionBId)' })
  @IsString()
  @MinLength(1)
  optionId!: string;
}
