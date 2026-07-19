import { PartialType } from '@nestjs/swagger'; // SPRINT-37: inherit every create-post validation rule while making fields optional
import { CreateFeedPostDto } from './create-feed-post.dto'; // SPRINT-37: keep update validation synchronized with creation

export class UpdateFeedPostDto extends PartialType(CreateFeedPostDto) {} // SPRINT-37: all create DTO fields are owner-editable; media is not a DTO field
