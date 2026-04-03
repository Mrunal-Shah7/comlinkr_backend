-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProviderType" AS ENUM ('LOCAL', 'GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "OtpType" AS ENUM ('REGISTRATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "SleepSchedule" AS ENUM ('EARLY_BIRD', 'NIGHT_OWL', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "Cleanliness" AS ENUM ('CLEAN', 'MODERATE', 'RELAXED');

-- CreateEnum
CREATE TYPE "NoiseTolerance" AS ENUM ('QUIET', 'MODERATE', 'SOCIAL');

-- CreateEnum
CREATE TYPE "GuestsFrequency" AS ENUM ('NEVER', 'OCCASIONALLY', 'FREQUENTLY');

-- CreateEnum
CREATE TYPE "FeedCategory" AS ENUM ('COMMUNITY', 'ANNOUNCEMENT', 'JOBS', 'ALERT', 'DISCUSSION', 'QUESTION', 'TIP');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOUSE', 'STUDIO', 'ROOM');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('AVAILABLE', 'RENTED', 'UNLISTED');

-- CreateEnum
CREATE TYPE "PriceRange" AS ENUM ('BUDGET', 'MODERATE', 'PREMIUM', 'LUXURY');

-- CreateEnum
CREATE TYPE "CommunityQuestionCategory" AS ENUM ('HOUSING', 'FOOD', 'TRANSIT', 'EVENTS', 'SAFETY', 'GENERAL');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP');

-- CreateEnum
CREATE TYPE "ConversationContextType" AS ENUM ('GENERAL', 'LISTING', 'EVENT');

-- CreateEnum
CREATE TYPE "ConversationMemberRole" AS ENUM ('MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ConversationMemberStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('SOCIAL', 'SPORTS', 'MUSIC', 'ARTS', 'FOOD_DRINK', 'TECH', 'HEALTH', 'COMMUNITY', 'EDUCATION');

-- CreateEnum
CREATE TYPE "EventFormat" AS ENUM ('IN_PERSON', 'VIRTUAL', 'HYBRID');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "StoryMediaType" AS ENUM ('REEL', 'PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "StoryCategory" AS ENUM ('EVENTS', 'FOOD', 'HOUSING', 'CULTURE', 'LOCAL_NEWS');

-- CreateEnum
CREATE TYPE "ChallengeType" AS ENUM ('PHOTO', 'FITNESS', 'FOOD', 'EXPLORE', 'SOCIAL', 'CREATIVE', 'GREEN', 'TRIVIA');

-- CreateEnum
CREATE TYPE "ChallengeDuration" AS ENUM ('ONE_DAY', 'THREE_DAYS', 'ONE_WEEK', 'TWO_WEEKS', 'ONE_MONTH');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "BadgeType" AS ENUM ('LANDLORD', 'RESTAURANT_OWNER', 'AGENCY', 'LOCAL_REVIEWER');

-- CreateEnum
CREATE TYPE "BadgeApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('OWN', 'MANAGE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('EVENT_NEARBY', 'COMMENT', 'LIKE', 'MESSAGE', 'BADGE_UPDATE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UpvoteTargetType" AS ENUM ('QUESTION', 'ANSWER');

-- CreateEnum
CREATE TYPE "CommunityCategory" AS ENUM ('CULTURAL_HERITAGE', 'NATIONAL_DIASPORA', 'LIFESTYLE', 'PROFESSIONAL', 'SOCIAL_CAUSE', 'FAITH_SPIRITUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "avatarFileId" TEXT,
    "bio" VARCHAR(200),
    "phoneNumber" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "agreementAcceptedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthProvider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProviderType" NOT NULL,
    "providerUserId" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "OtpType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "dialCode" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vibe" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,

    CONSTRAINT "Vibe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CommunityCategory" NOT NULL,
    "countryCode" TEXT,
    "emoji" TEXT NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoommatePreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetMin" INTEGER,
    "budgetMax" INTEGER,
    "moveInDate" TIMESTAMP(3),
    "sleepSchedule" "SleepSchedule",
    "cleanliness" "Cleanliness",
    "noiseTolerance" "NoiseTolerance",
    "petFriendly" BOOLEAN NOT NULL DEFAULT false,
    "smokingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "guestsFrequency" "GuestsFrequency",
    "workFromHome" BOOLEAN NOT NULL DEFAULT false,
    "aboutMe" VARCHAR(500),
    "isLooking" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RoommatePreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "category" "FeedCategory" NOT NULL,
    "tags" TEXT[],
    "location" TEXT,
    "sourceLabel" TEXT,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "savesCount" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPostMedia" (
    "id" TEXT NOT NULL,
    "feedPostId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeedPostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedPostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedComment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedPostId" TEXT NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedPostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousingListing" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "deposit" DECIMAL(65,30),
    "bedrooms" INTEGER NOT NULL,
    "bathrooms" INTEGER NOT NULL,
    "sqft" INTEGER,
    "floor" TEXT,
    "address" TEXT NOT NULL,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "availableDate" TIMESTAMP(3),
    "leaseTerm" TEXT,
    "isFurnished" BOOLEAN NOT NULL DEFAULT false,
    "petPolicy" TEXT,
    "parking" TEXT,
    "laundry" TEXT,
    "heating" TEXT,
    "cooling" TEXT,
    "utilities" TEXT,
    "yearBuilt" INTEGER,
    "amenities" TEXT[],
    "transitInfo" TEXT,
    "walkScore" INTEGER,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "status" "ListingStatus" NOT NULL DEFAULT 'AVAILABLE',
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousingListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousingImage" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,

    CONSTRAINT "HousingImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousingInterest" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousingInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cuisine" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phoneNumber" TEXT,
    "priceRange" "PriceRange" NOT NULL,
    "averageRating" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "distanceMiles" DECIMAL(65,30),
    "waitTimeMinutes" INTEGER,
    "openingTime" TEXT,
    "closingTime" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "availableServices" TEXT[],
    "popularDishes" JSONB,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantImage" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RestaurantImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantReview" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantReservation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantFavorite" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityQuestion" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" TEXT,
    "category" "CommunityQuestionCategory" NOT NULL,
    "tags" TEXT[],
    "upvoteCount" INTEGER NOT NULL DEFAULT 0,
    "answerCount" INTEGER NOT NULL DEFAULT 0,
    "city" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "upvoteCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityUpvote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" "UpvoteTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityUpvote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunitySave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "title" TEXT,
    "contextType" "ConversationContextType" NOT NULL DEFAULT 'GENERAL',
    "contextId" TEXT,
    "createdById" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ConversationMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "ConversationMemberStatus" NOT NULL DEFAULT 'PENDING',
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "fileId" TEXT,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "category" "EventCategory" NOT NULL,
    "format" "EventFormat" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "venue" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "ticketType" "TicketType" NOT NULL DEFAULT 'FREE',
    "ticketPrice" DECIMAL(65,30),
    "capacity" INTEGER,
    "attendeeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendee" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "mediaType" "StoryMediaType" NOT NULL,
    "category" "StoryCategory" NOT NULL,
    "details" VARCHAR(500),
    "hashtags" TEXT[],
    "durationSeconds" INTEGER,
    "location" TEXT,
    "fileId" TEXT,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "type" "ChallengeType" NOT NULL,
    "details" VARCHAR(500),
    "duration" "ChallengeDuration" NOT NULL,
    "goalCondition" TEXT NOT NULL,
    "reward" TEXT NOT NULL,
    "maxParticipants" INTEGER,
    "hashtags" TEXT[],
    "location" TEXT,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeParticipant" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeType" "BadgeType" NOT NULL,
    "status" "BadgeApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "fullLegalName" TEXT NOT NULL,
    "businessPhone" TEXT NOT NULL,
    "businessEmail" TEXT,
    "ownershipType" "OwnershipType",
    "propertyAddress" TEXT,
    "restaurantName" TEXT,
    "cuisineType" TEXT,
    "restaurantAddress" TEXT,
    "agencyName" TEXT,
    "agencyLicense" TEXT,
    "propertiesManaged" INTEGER,
    "companyWebsite" TEXT,
    "neighborhoodArea" TEXT,
    "reviewerBio" TEXT,
    "adminNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeType" "BadgeType" NOT NULL,
    "applicationId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eventsNearby" BOOLEAN NOT NULL DEFAULT true,
    "comments" BOOLEAN NOT NULL DEFAULT true,
    "likes" BOOLEAN NOT NULL DEFAULT false,
    "messages" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacySettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicProfile" BOOLEAN NOT NULL DEFAULT true,
    "showLocation" BOOLEAN NOT NULL DEFAULT true,
    "activityStatus" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PrivacySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedUser" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserVibes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserVibes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_UserInterests" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserInterests_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_UserCommunities" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserCommunities_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_avatarFileId_key" ON "User"("avatarFileId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AuthProvider_provider_providerUserId_key" ON "AuthProvider"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthProvider_userId_provider_key" ON "AuthProvider"("userId", "provider");

-- CreateIndex
CREATE INDEX "OtpCode_email_idx" ON "OtpCode"("email");

-- CreateIndex
CREATE INDEX "OtpCode_type_idx" ON "OtpCode"("type");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocation_userId_key" ON "UserLocation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vibe_slug_key" ON "Vibe"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_slug_key" ON "Interest"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Community_slug_key" ON "Community"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RoommatePreferences_userId_key" ON "RoommatePreferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedLike_userId_feedPostId_key" ON "FeedLike"("userId", "feedPostId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSave_userId_feedPostId_key" ON "FeedSave"("userId", "feedPostId");

-- CreateIndex
CREATE UNIQUE INDEX "HousingInterest_listingId_userId_key" ON "HousingInterest"("listingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantReview_restaurantId_userId_key" ON "RestaurantReview"("restaurantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantFavorite_restaurantId_userId_key" ON "RestaurantFavorite"("restaurantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityUpvote_userId_targetType_targetId_key" ON "CommunityUpvote"("userId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunitySave_userId_questionId_key" ON "CommunitySave"("userId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendee_eventId_userId_key" ON "EventAttendee"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeParticipant_challengeId_userId_key" ON "ChallengeParticipant"("challengeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_applicationId_key" ON "UserBadge"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeType_key" ON "UserBadge"("userId", "badgeType");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacySettings_userId_key" ON "PrivacySettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedUser_blockerId_blockedId_key" ON "BlockedUser"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "_UserVibes_B_index" ON "_UserVibes"("B");

-- CreateIndex
CREATE INDEX "_UserInterests_B_index" ON "_UserInterests"("B");

-- CreateIndex
CREATE INDEX "_UserCommunities_B_index" ON "_UserCommunities"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarFileId_fkey" FOREIGN KEY ("avatarFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthProvider" ADD CONSTRAINT "AuthProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoommatePreferences" ADD CONSTRAINT "RoommatePreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostMedia" ADD CONSTRAINT "FeedPostMedia_feedPostId_fkey" FOREIGN KEY ("feedPostId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostMedia" ADD CONSTRAINT "FeedPostMedia_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedLike" ADD CONSTRAINT "FeedLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedLike" ADD CONSTRAINT "FeedLike_feedPostId_fkey" FOREIGN KEY ("feedPostId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_feedPostId_fkey" FOREIGN KEY ("feedPostId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedSave" ADD CONSTRAINT "FeedSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedSave" ADD CONSTRAINT "FeedSave_feedPostId_fkey" FOREIGN KEY ("feedPostId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousingListing" ADD CONSTRAINT "HousingListing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousingImage" ADD CONSTRAINT "HousingImage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "HousingListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousingImage" ADD CONSTRAINT "HousingImage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousingInterest" ADD CONSTRAINT "HousingInterest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "HousingListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousingInterest" ADD CONSTRAINT "HousingInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantImage" ADD CONSTRAINT "RestaurantImage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantImage" ADD CONSTRAINT "RestaurantImage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantReview" ADD CONSTRAINT "RestaurantReview_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantReview" ADD CONSTRAINT "RestaurantReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantReservation" ADD CONSTRAINT "RestaurantReservation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantReservation" ADD CONSTRAINT "RestaurantReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantFavorite" ADD CONSTRAINT "RestaurantFavorite_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantFavorite" ADD CONSTRAINT "RestaurantFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityQuestion" ADD CONSTRAINT "CommunityQuestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAnswer" ADD CONSTRAINT "CommunityAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CommunityQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAnswer" ADD CONSTRAINT "CommunityAnswer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityUpvote" ADD CONSTRAINT "CommunityUpvote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySave" ADD CONSTRAINT "CommunitySave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunitySave" ADD CONSTRAINT "CommunitySave_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CommunityQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeApplication" ADD CONSTRAINT "BadgeApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeApplication" ADD CONSTRAINT "BadgeApplication_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeDocument" ADD CONSTRAINT "BadgeDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "BadgeApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadgeDocument" ADD CONSTRAINT "BadgeDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "BadgeApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacySettings" ADD CONSTRAINT "PrivacySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedUser" ADD CONSTRAINT "BlockedUser_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedUser" ADD CONSTRAINT "BlockedUser_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserVibes" ADD CONSTRAINT "_UserVibes_A_fkey" FOREIGN KEY ("A") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserVibes" ADD CONSTRAINT "_UserVibes_B_fkey" FOREIGN KEY ("B") REFERENCES "Vibe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserInterests" ADD CONSTRAINT "_UserInterests_A_fkey" FOREIGN KEY ("A") REFERENCES "Interest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserInterests" ADD CONSTRAINT "_UserInterests_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserCommunities" ADD CONSTRAINT "_UserCommunities_A_fkey" FOREIGN KEY ("A") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserCommunities" ADD CONSTRAINT "_UserCommunities_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
