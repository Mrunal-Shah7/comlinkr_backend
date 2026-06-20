import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReplyToTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reply: string;

  @IsOptional()
  @IsBoolean()
  close?: boolean;
}
