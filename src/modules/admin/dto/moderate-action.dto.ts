import { IsIn, IsString } from 'class-validator';

export class ModerateActionDto {
  @IsString()
  @IsIn(['approve', 'reject', 'delete', 'hide', 'suspend'])
  action: string;
}
