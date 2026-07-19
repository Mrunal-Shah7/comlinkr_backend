-- SPRINT-37: Track explicit author edits independently from automatic FeedPost updates.
ALTER TABLE "FeedPost" ADD COLUMN "editedAt" TIMESTAMP(3);

-- SPRINT-37: HousingListing already has an automatically managed updatedAt timestamp, so no duplicate edit column is added.
