import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BadgeType, OwnershipType } from '@prisma/client';

export class ApplyBadgeDto {
  @ApiProperty({ enum: BadgeType })
  @IsEnum(BadgeType)
  badgeType: BadgeType;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullLegalName: string;

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  businessPhone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @ApiPropertyOptional({ enum: OwnershipType })
  @IsOptional()
  @IsEnum(OwnershipType)
  ownershipType?: OwnershipType;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  propertyAddress?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  restaurantName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cuisineType?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  restaurantAddress?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  agencyName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  agencyLicense?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  propertiesManaged?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  companyWebsite?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  neighborhoodArea?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewerBio?: string;
}
