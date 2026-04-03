import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

class LocationDto {
  @ApiProperty()
  country: string;

  @ApiProperty()
  countryCode: string;

  @ApiProperty()
  dialCode: string;

  @ApiProperty()
  state: string;

  @ApiProperty()
  city: string;
}

class VibeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  emoji: string;
}

class InterestDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  icon: string;
}

class CommunityDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  category: string;

  @ApiProperty({ required: false, nullable: true })
  countryCode?: string | null;

  @ApiProperty()
  emoji: string;
}

class RoommatePreferencesDto {
  @ApiProperty({ required: false, nullable: true })
  budgetMin?: number | null;

  @ApiProperty({ required: false, nullable: true })
  budgetMax?: number | null;

  @ApiProperty({ required: false, nullable: true, type: String })
  moveInDate?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  sleepSchedule?: string | null;

  @ApiProperty({ required: false, nullable: true })
  cleanliness?: string | null;

  @ApiProperty({ required: false, nullable: true })
  noiseTolerance?: string | null;

  @ApiProperty()
  petFriendly: boolean;

  @ApiProperty()
  smokingAllowed: boolean;

  @ApiProperty({ required: false, nullable: true })
  guestsFrequency?: string | null;

  @ApiProperty()
  workFromHome: boolean;

  @ApiProperty({ required: false, nullable: true })
  aboutMe?: string | null;

  @ApiProperty()
  isLooking: boolean;
}

class BadgeDto {
  @ApiProperty()
  badgeType: string;

  @ApiProperty()
  grantedAt: Date;
}

export class UserStatsDto {
  @ApiProperty()
  postsCount: number;

  @ApiProperty()
  savedCount: number;

  @ApiProperty()
  eventsCount: number;

  @ApiProperty()
  neighborsCount: number;
}

export class AchievementDto {
  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  icon: string;

  @ApiProperty()
  earned: boolean;
}

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ nullable: true })
  bio: string | null;

  @ApiProperty({ nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  onboardingDone: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: LocationDto, nullable: true })
  location: LocationDto | null;

  @ApiProperty({ type: [VibeDto] })
  vibes: VibeDto[];

  @ApiProperty({ type: [InterestDto] })
  interests: InterestDto[];

  @ApiProperty({ type: [CommunityDto] })
  communities: CommunityDto[];

  @ApiProperty({ type: RoommatePreferencesDto, nullable: true })
  roommatePreferences: RoommatePreferencesDto | null;

  @ApiProperty({ type: [BadgeDto] })
  badges: BadgeDto[];

  @ApiProperty({ type: UserStatsDto })
  stats: UserStatsDto;

  @ApiProperty({ type: [AchievementDto] })
  achievements: AchievementDto[];
}

