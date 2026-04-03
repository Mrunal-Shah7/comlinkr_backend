import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AdminContentQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['feed_posts', 'housing', 'restaurants'])
  contentType?: 'feed_posts' | 'housing' | 'restaurants';

  @IsOptional()
  @IsString()
  search?: string;
}
