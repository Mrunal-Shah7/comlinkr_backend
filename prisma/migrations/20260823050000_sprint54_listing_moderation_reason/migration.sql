-- SPRINT-54: persist optional listing rejection reason for owner visibility
ALTER TABLE "HousingListing" ADD COLUMN "moderationReason" VARCHAR(500);
