import { PartialType } from '@nestjs/swagger';
import { CreateRoommateListingDto } from './create-roommate-listing.dto';

export class PatchRoommateListingDto extends PartialType(CreateRoommateListingDto) {}
