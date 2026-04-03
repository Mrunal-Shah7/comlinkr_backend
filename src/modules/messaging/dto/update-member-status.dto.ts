import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateMemberStatusDto {
  @ApiProperty({ enum: ['ACCEPTED', 'BLOCKED'] })
  @IsIn(['ACCEPTED', 'BLOCKED'])
  status: 'ACCEPTED' | 'BLOCKED';
}
