import { Type } from 'class-transformer'; // SPRINT-34: transform an optional structured Apple name for nested validation
import { // SPRINT-34: validate flat and structured Apple request fields
  IsNotEmpty, // SPRINT-34: preserve required identity-token validation
  IsOptional, // SPRINT-34: keep name and authorization code backward-compatible
  IsString, // SPRINT-34: constrain every supplied text field
  MaxLength, // SPRINT-34: retain display-name length protection
  ValidateNested, // SPRINT-34: validate optional Apple given/family name parts
} from 'class-validator'; // SPRINT-34: complete Apple DTO validator imports
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AppleStructuredNameDto { // SPRINT-34: accept null-safe given and family name parts when a client sends them
  @ApiPropertyOptional() // SPRINT-34: document the optional Apple given name
  @IsOptional() // SPRINT-34: Apple may omit the given name
  @IsString() // SPRINT-34: reject non-string given names
  @MaxLength(100) // SPRINT-34: bound structured name input
  givenName?: string; // SPRINT-34: retain an optional given name

  @ApiPropertyOptional() // SPRINT-34: document the optional Apple family name
  @IsOptional() // SPRINT-34: Apple may omit the family name
  @IsString() // SPRINT-34: reject non-string family names
  @MaxLength(100) // SPRINT-34: bound structured name input
  familyName?: string; // SPRINT-34: retain an optional family name
} // SPRINT-34: complete structured Apple name DTO

export class AppleAuthDto {
  @ApiProperty({ description: 'Apple ID token from client' })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiPropertyOptional({
    description: 'Full name (only on first authorization)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ type: AppleStructuredNameDto }) // SPRINT-34: document optional structured Apple name input
  @IsOptional() // SPRINT-34: preserve clients that send only a flat fullName
  @ValidateNested() // SPRINT-34: validate supplied given/family name fields
  @Type(() => AppleStructuredNameDto) // SPRINT-34: instantiate nested name data for validation
  name?: AppleStructuredNameDto; // SPRINT-34: support the structured-name fallback chain

  @ApiPropertyOptional({ // SPRINT-34: document Apple's short-lived native authorization code
    description: 'Apple authorization code used to obtain a revocation token', // SPRINT-34: explain the optional revocation contract
  }) // SPRINT-34: close authorization-code Swagger metadata
  @IsOptional() // SPRINT-34: remain compatible with mobile builds that do not send the code
  @IsString() // SPRINT-34: reject non-string authorization-code values
  authorizationCode?: string; // SPRINT-34: accept the code returned by expo-apple-authentication
}
