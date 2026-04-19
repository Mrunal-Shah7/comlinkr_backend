import { PartialType } from '@nestjs/swagger';
import { CreateSharedSpaceDto } from './create-shared-space.dto';

export class UpdateSharedSpaceDto extends PartialType(CreateSharedSpaceDto) {}
