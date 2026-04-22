import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddNewsCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;
}
