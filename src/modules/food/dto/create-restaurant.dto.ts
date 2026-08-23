import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PriceRange } from '@prisma/client';
import { PopularDishDto } from './popular-dish.dto';

export class CreateRestaurantDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  cuisine: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @ApiProperty({ enum: PriceRange })
  @IsEnum(PriceRange)
  priceRange: PriceRange;

  @ApiPropertyOptional({ minimum: 0 }) // SPRINT-33: expose avg price per person in create payload
  @IsOptional() // SPRINT-33: optional field for backward compatibility
  @IsInt() // SPRINT-33: enforce integer semantics matching Prisma Int
  @Min(0, {
    message: 'Average price per person must be a non-negative integer',
  }) // SPRINT-33: explicit validation message from sprint spec
  avgPricePerPerson?: number; // SPRINT-33: optional average spend per person

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  waitTimeMinutes?: number;

  @ApiPropertyOptional({ maxLength: 20, example: '11:00 AM' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  openingTime?: string;

  @ApiPropertyOptional({ maxLength: 20, example: '10:30 PM' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  closingTime?: string;

  @ApiProperty({
    description: 'e.g. ["Dine-in", "Takeout", "Delivery"]',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  availableServices: string[];

  @ApiPropertyOptional({
    type: [PopularDishDto],
    description: 'Popular dishes with name and rank',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PopularDishDto)
  popularDishes?: PopularDishDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
